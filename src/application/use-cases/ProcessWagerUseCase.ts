import { v4 as uuidv4 } from "uuid";
import { IWalletRepository } from "../ports/IWalletRepository";
import { WagerTransaction } from "../../domain/models/WagerTransaction";
import { WalletLedgerEntry } from "../../domain/models/WalletLedgerEntry";
import { Money } from "../../domain/models/Money";
import {
  WagerTransactionStatus,
  WagerTransactionKind,
} from "../../domain/models/WagerTransaction";
import { FailureCode } from "../../domain/errors/DomainError";
import { calculatePayloadHash } from "../utils/CanonicalJson";
import { InboxMessage } from "../../domain/models/InboxMessage";
import { OutboxMessage } from "../../domain/models/OutboxMessage";
import {
  WagerTransactionPendingReference,
  WagerTransactionProcessed,
  WagerTransactionRejected,
  WalletBalanceChanged,
} from "../../domain/events/DomainEvents";
import { MetricsService } from "../../infrastructure/observability/MetricsService";

export interface ProcessWagerCommand {
  providerId: string;
  externalTransactionId: string;
  idempotencyKey: string;
  walletId: string;
  playerId: string;
  roundId?: string;
  gameId: string;
  kind: string;
  amount: string;
  currency: string;
  referenceExternalTransactionId?: string;
  correlationId?: string;
  inboxMessage?: InboxMessage;
  referenceRetryExhausted?: boolean;
}

export interface ProcessWagerOutput {
  transactionId: string;
  status: WagerTransactionStatus;
  walletId: string;
  currentBalance: string;
  walletVersion: number;
  failureCode?: FailureCode;
  isIdempotentReplay: boolean;
}

export class ProcessWagerUseCase {
  constructor(
    private readonly walletRepository: IWalletRepository,
    private readonly metrics?: MetricsService,
  ) {}

  async findTransactionById(
    transactionId: string,
  ): Promise<WagerTransaction | null> {
    return this.walletRepository.findTransactionById(transactionId);
  }

  async findTransactionByExternalId(
    providerId: string,
    externalTransactionId: string,
  ): Promise<WagerTransaction | null> {
    return this.walletRepository.findTransactionByExternalId(
      providerId,
      externalTransactionId,
    );
  }

  private normalizeKind(kind: string): WagerTransactionKind {
    const upper = kind?.toUpperCase();
    switch (upper) {
      case "BET":
        return WagerTransactionKind.Bet;
      case "WIN":
        return WagerTransactionKind.Win;
      case "REFUND":
        return WagerTransactionKind.Refund;
      case "ROLLBACK":
        return WagerTransactionKind.Rollback;
      case "LOSS":
        return WagerTransactionKind.Loss;
      default:
        throw new Error(`Unsupported wager kind: ${kind}`);
    }
  }

  private mapErrorToFailureCode(error: unknown): FailureCode {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("Insufficient funds") || message.includes("saldo")) {
      return FailureCode.InsufficientFunds;
    }
    if (message.includes("negative") || message.includes("negativo")) {
      return FailureCode.NegativeBalanceReversal;
    }
    return FailureCode.InfrastructureFailure;
  }

  async execute(input: ProcessWagerCommand): Promise<ProcessWagerOutput> {
    const startedAt = Date.now();
    const payloadHash = calculatePayloadHash({
      providerId: input.providerId,
      externalTransactionId: input.externalTransactionId,
      walletId: input.walletId,
      playerId: input.playerId,
      roundId: input.roundId,
      gameId: input.gameId,
      kind: input.kind,
      amount: input.amount,
      currency: input.currency,
      referenceExternalTransactionId: input.referenceExternalTransactionId,
    });

    try {
      return await this.walletRepository.transactional(
        async (repo: IWalletRepository) => {
          try {
            let pendingTransaction: WagerTransaction | undefined;
            const existing = await repo.findTransactionByIdempotencyKey(
              input.idempotencyKey,
            );

            if (existing) {
              if (existing.payloadHash !== payloadHash) {
                const wallet = await repo.findById(input.walletId);
                this.metrics?.increment("duplicates_detected");
                return {
                  transactionId: existing.id,
                  status: WagerTransactionStatus.Rejected,
                  walletId: existing.walletId,
                  currentBalance: wallet ? wallet.balance.toString() : "0.00",
                  walletVersion: wallet?.version ?? 0,
                  failureCode: FailureCode.IdempotencyPayloadConflict,
                  isIdempotentReplay: false,
                };
              }

              if (existing.status !== WagerTransactionStatus.PendingReference) {
                const wallet = await repo.findById(input.walletId);
                this.metrics?.increment("duplicates_detected");
                return {
                  transactionId: existing.id,
                  status: existing.status,
                  walletId: existing.walletId,
                  currentBalance: wallet ? wallet.balance.toString() : "0.00",
                  walletVersion: wallet?.version ?? 0,
                  isIdempotentReplay: true,
                };
              }
              pendingTransaction = existing;
            }

            const wallet = await repo.findById(input.walletId, true);
            if (!wallet) {
              throw new Error(`Wallet "${input.walletId}" not found`);
            }

            const kind = this.normalizeKind(input.kind);
            const amount = Money.from({
              amount: input.amount,
              currency: input.currency,
            });
            const transaction =
              pendingTransaction ??
              WagerTransaction.create({
                id: uuidv4(),
                providerId: input.providerId,
                externalTransactionId: input.externalTransactionId,
                idempotencyKey: input.idempotencyKey,
                payloadHash,
                walletId: input.walletId,
                playerId: input.playerId,
                roundId: input.roundId ?? "",
                gameId: input.gameId,
                kind,
                money: amount,
                referenceExternalTransactionId:
                  input.referenceExternalTransactionId,
              });

            const balanceBefore = wallet.balance;
            let ledgerEntry: WalletLedgerEntry | undefined;
            let failureCode: FailureCode | undefined;
            let reference: WagerTransaction | null = null;
            const outboxMessages: OutboxMessage[] = [];
            const correlationId = input.correlationId ?? uuidv4();

            if (transaction.requiresReference()) {
              reference = await repo.findTransactionByExternalId(
                transaction.providerId,
                transaction.referenceExternalTransactionId!,
              );

              if (!reference) {
                if (pendingTransaction) {
                  return {
                    transactionId: transaction.id,
                    status: transaction.status,
                    walletId: transaction.walletId,
                    currentBalance: wallet.balance.toString(),
                    walletVersion: wallet.version,
                    isIdempotentReplay: true,
                  };
                }
                if (input.referenceRetryExhausted) {
                  transaction.reject(FailureCode.ReferenceNotFound);
                  outboxMessages.push(
                    OutboxMessage.enqueue(
                      new WagerTransactionRejected({
                        eventId: uuidv4(),
                        aggregateId: transaction.walletId,
                        correlationId,
                        occurredAt: new Date(),
                        data: {
                          transactionId: transaction.id,
                          providerId: transaction.providerId,
                          externalTransactionId:
                            transaction.externalTransactionId,
                          walletId: transaction.walletId,
                          playerId: transaction.playerId,
                          roundId: transaction.roundId,
                          gameId: transaction.gameId,
                          kind: transaction.kind,
                          money: transaction.money.toJSON(),
                          failureCode: FailureCode.ReferenceNotFound,
                          reason: FailureCode.ReferenceNotFound,
                          rejectedAt: new Date().toISOString(),
                        },
                      }),
                    ),
                  );
                  await repo.saveWagerAtomic({
                    wallet,
                    transaction,
                    outboxMessages,
                    inboxMessage: input.inboxMessage,
                  });
                  return {
                    transactionId: transaction.id,
                    status: transaction.status,
                    walletId: transaction.walletId,
                    currentBalance: wallet.balance.toString(),
                    walletVersion: wallet.version,
                    failureCode: FailureCode.ReferenceNotFound,
                    isIdempotentReplay: false,
                  };
                }
                transaction.markPendingReference();
                outboxMessages.push(
                  OutboxMessage.enqueue(
                    new WagerTransactionPendingReference({
                      eventId: uuidv4(),
                      aggregateId: transaction.walletId,
                      correlationId,
                      occurredAt: new Date(),
                      data: {
                        transactionId: transaction.id,
                        providerId: transaction.providerId,
                        externalTransactionId:
                          transaction.externalTransactionId,
                        referenceExternalTransactionId:
                          transaction.referenceExternalTransactionId!,
                        walletId: transaction.walletId,
                        kind: transaction.kind,
                      },
                    }),
                  ),
                );
                await repo.saveWagerAtomic({
                  wallet,
                  transaction,
                  outboxMessages,
                  inboxMessage: input.inboxMessage,
                });
                this.metrics?.increment(
                  transaction.status === WagerTransactionStatus.Processed
                    ? "transactions_processed"
                    : "transactions_rejected",
                );
                this.metrics?.observeProcessing(Date.now() - startedAt);
                console.log(
                  JSON.stringify({
                    event:
                      transaction.status === WagerTransactionStatus.Processed
                        ? "transaction_processed"
                        : "transaction_rejected",
                    correlationId,
                    transactionId: transaction.id,
                    walletId: transaction.walletId,
                    providerId: transaction.providerId,
                    status: transaction.status,
                  }),
                );
                return {
                  transactionId: transaction.id,
                  status: transaction.status,
                  walletId: transaction.walletId,
                  currentBalance: wallet.balance.toString(),
                  walletVersion: wallet.version,
                  isIdempotentReplay: false,
                };
              }

              const validReference =
                reference.status === WagerTransactionStatus.Processed &&
                reference.walletId === transaction.walletId &&
                reference.playerId === transaction.playerId &&
                reference.roundId === transaction.roundId &&
                reference.money.currency === transaction.money.currency &&
                reference.money.equals(transaction.money) &&
                (transaction.kind === WagerTransactionKind.Refund
                  ? reference.kind === WagerTransactionKind.Bet
                  : [
                      WagerTransactionKind.Bet,
                      WagerTransactionKind.Win,
                      WagerTransactionKind.Refund,
                    ].includes(reference.kind));

              if (!validReference) {
                failureCode = FailureCode.ReferenceMismatch;
                transaction.reject(failureCode);
              } else if (
                await repo.findReversalByReference(
                  reference.id,
                  transaction.kind,
                )
              ) {
                failureCode = FailureCode.ReferenceAlreadyReversed;
                transaction.reject(failureCode);
              }
            }

            try {
              if (transaction.status === WagerTransactionStatus.Rejected) {
                throw new Error(failureCode);
              }
              switch (kind) {
                case WagerTransactionKind.Bet:
                  wallet.debit(amount);
                  break;
                case WagerTransactionKind.Win:
                case WagerTransactionKind.Refund:
                case WagerTransactionKind.Rollback:
                  if (reference && reference.ledgerDirectionFor() === "DEBIT") {
                    wallet.credit(amount);
                  } else {
                    wallet.debit(amount);
                  }
                  break;
                case WagerTransactionKind.Loss:
                  break;
                default:
                  throw new Error(
                    `Unsupported wager kind: ${String(input.kind)}`,
                  );
              }

              transaction.markProcessed(reference?.id);

              if (transaction.affectsBalance()) {
                ledgerEntry = WalletLedgerEntry.create({
                  id: uuidv4(),
                  walletId: wallet.id,
                  transactionId: transaction.id,
                  direction: transaction.ledgerDirectionFor(
                    reference ?? undefined,
                  ),
                  money: amount,
                  balanceBefore,
                  balanceAfter: wallet.balance,
                });
              }
            } catch (error) {
              if (transaction.status !== WagerTransactionStatus.Rejected) {
                failureCode = this.mapErrorToFailureCode(error);
                transaction.reject(failureCode);
              }
            }

            if (transaction.status === WagerTransactionStatus.Processed) {
              outboxMessages.push(
                OutboxMessage.enqueue(
                  new WagerTransactionProcessed({
                    eventId: uuidv4(),
                    aggregateId: transaction.walletId,
                    correlationId,
                    occurredAt: new Date(),
                    data: {
                      transactionId: transaction.id,
                      providerId: transaction.providerId,
                      externalTransactionId: transaction.externalTransactionId,
                      walletId: transaction.walletId,
                      playerId: transaction.playerId,
                      roundId: transaction.roundId,
                      gameId: transaction.gameId,
                      kind: transaction.kind,
                      money: transaction.money.toJSON(),
                      referenceTransactionId:
                        transaction.referenceTransactionId,
                      processedAt: transaction.processedAt!.toISOString(),
                    },
                  }),
                ),
              );
              if (ledgerEntry) {
                outboxMessages.push(
                  OutboxMessage.enqueue(
                    new WalletBalanceChanged({
                      eventId: uuidv4(),
                      aggregateId: transaction.walletId,
                      correlationId,
                      occurredAt: new Date(),
                      data: {
                        walletId: transaction.walletId,
                        transactionId: transaction.id,
                        direction: ledgerEntry.direction,
                        money: ledgerEntry.money.toJSON(),
                        balanceBefore: ledgerEntry.balanceBefore.toJSON(),
                        balanceAfter: ledgerEntry.balanceAfter.toJSON(),
                        walletVersion: wallet.version,
                      },
                    }),
                  ),
                );
              }
            } else if (failureCode) {
              outboxMessages.push(
                OutboxMessage.enqueue(
                  new WagerTransactionRejected({
                    eventId: uuidv4(),
                    aggregateId: transaction.walletId,
                    correlationId,
                    occurredAt: new Date(),
                    data: {
                      transactionId: transaction.id,
                      providerId: transaction.providerId,
                      externalTransactionId: transaction.externalTransactionId,
                      walletId: transaction.walletId,
                      playerId: transaction.playerId,
                      roundId: transaction.roundId,
                      gameId: transaction.gameId,
                      kind: transaction.kind,
                      money: transaction.money.toJSON(),
                      failureCode,
                      reason: failureCode,
                      rejectedAt: transaction.processedAt!.toISOString(),
                    },
                  }),
                ),
              );
            }

            await repo.saveWagerAtomic({
              wallet,
              transaction,
              ledgerEntry,
              outboxMessages,
              inboxMessage: input.inboxMessage,
            });

            return {
              transactionId: transaction.id,
              status: transaction.status,
              walletId: transaction.walletId,
              currentBalance: wallet.balance.toString(),
              walletVersion: wallet.version,
              failureCode,
              isIdempotentReplay: false,
            };
          } catch (error: any) {
            const errorMessage = error?.message || "";
            const errorCode = error?.code || error?.driverError?.code;

            if (
              errorCode === "23505" ||
              errorMessage.includes("uq_wager_transactions_idempotency") ||
              errorMessage.includes("UniqueConstraintViolationException")
            ) {
              throw new Error(`DUPLICATE_IDEMPOTENCY:${input.idempotencyKey}`);
            }
            throw error;
          }
        },
      );
    } catch (outerError: any) {
      const outerCode = outerError?.code || outerError?.driverError?.code;
      if (outerCode === "55P03" || outerCode === "40P01") {
        this.metrics?.increment("lock_conflicts");
      }
      if (outerError?.message?.startsWith("DUPLICATE_IDEMPOTENCY:")) {
        return await this.walletRepository.transactional(
          async (repo: IWalletRepository) => {
            const concurrentExisting =
              await repo.findTransactionByIdempotencyKey(input.idempotencyKey);
            if (concurrentExisting) {
              if (concurrentExisting.payloadHash !== payloadHash) {
                return {
                  transactionId: concurrentExisting.id,
                  status: WagerTransactionStatus.Rejected,
                  walletId: concurrentExisting.walletId,
                  currentBalance: "0.00",
                  walletVersion: 0,
                  failureCode: FailureCode.IdempotencyPayloadConflict,
                  isIdempotentReplay: false,
                };
              }

              const wallet = await repo.findById(input.walletId);
              return {
                transactionId: concurrentExisting.id,
                status: concurrentExisting.status,
                walletId: concurrentExisting.walletId,
                currentBalance: wallet ? wallet.balance.toString() : "0.00",
                walletVersion: wallet?.version ?? 0,
                isIdempotentReplay: true,
              };
            }
            throw outerError;
          },
        );
      }
      throw outerError;
    }
  }
}
