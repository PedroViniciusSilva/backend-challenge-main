import { ProcessWagerUseCase } from "../../application/use-cases/ProcessWagerUseCase";
import type { IWalletRepository } from "../../application/ports/IWalletRepository";
import { WagerTransaction } from "../../domain/models/WagerTransaction";

export interface PendingReferenceWorkerOptions {
  batchSize?: number;
  baseIntervalMs?: number;
  maxBackoffMs?: number;
  maxAttempts?: number;
}

export class PendingReferenceWorker {
  private running = false;
  private polling?: Promise<void>;
  private readonly fallbackAttempts = new Map<string, number>();
  private readonly fallbackNextAttemptAt = new Map<string, number>();

  constructor(
    private readonly repository: IWalletRepository,
    private readonly processWager: ProcessWagerUseCase,
    private readonly options: PendingReferenceWorkerOptions = {},
  ) {}

  start(): void {
    if (this.running) return;
    this.running = true;
    this.polling = this.run();
  }

  async stop(): Promise<void> {
    this.running = false;
    await this.polling;
    this.polling = undefined;
  }

  async processBatch(): Promise<number> {
    const transactions = await this.repository.findPendingReferenceTransactions(
      Math.min(this.options.batchSize ?? 10, 100),
    );
    let processed = 0;

    for (const transaction of transactions) {
      const retry = this.repository.getPendingReferenceRetry
        ? await this.repository.getPendingReferenceRetry(transaction.id)
        : {
            attempts: this.fallbackAttempts.get(transaction.id) ?? 0,
            nextAttemptAt: new Date(
              this.fallbackNextAttemptAt.get(transaction.id) ?? 0,
            ),
          };
      if ((retry.nextAttemptAt?.getTime() ?? 0) > Date.now()) continue;

      try {
        const result = await this.processWager.execute({
          ...this.toCommand(transaction),
          referenceRetryExhausted:
            retry.attempts + 1 >= (this.options.maxAttempts ?? 5),
        });
        if (result.status === "PENDING_REFERENCE") {
          throw new Error("REFERENCE_NOT_READY");
        }
        if (this.repository.clearPendingReferenceRetry) {
          await this.repository.clearPendingReferenceRetry(transaction.id);
        }
        this.fallbackAttempts.delete(transaction.id);
        this.fallbackNextAttemptAt.delete(transaction.id);
        processed++;
      } catch {
        const nextAttempt = retry.attempts + 1;
        const nextAttemptAt = new Date(
          Date.now() +
            Math.min(
              (this.options.baseIntervalMs ?? 1000) * 2 ** (nextAttempt - 1),
              this.options.maxBackoffMs ?? 30_000,
            ),
        );
        if (this.repository.savePendingReferenceRetry) {
          await this.repository.savePendingReferenceRetry(
            transaction.id,
            nextAttempt,
            nextAttemptAt,
          );
        }
        this.fallbackAttempts.set(transaction.id, nextAttempt);
        this.fallbackNextAttemptAt.set(transaction.id, nextAttemptAt.getTime());
      }
    }
    return processed;
  }

  private async run(): Promise<void> {
    const interval = this.options.baseIntervalMs ?? 1000;
    while (this.running) {
      try {
        await this.processBatch();
      } catch {
        // A later poll retries transient database failures.
      }
      if (this.running)
        await new Promise((resolve) => setTimeout(resolve, interval));
    }
  }

  private toCommand(transaction: WagerTransaction) {
    return {
      providerId: transaction.providerId,
      externalTransactionId: transaction.externalTransactionId,
      idempotencyKey: transaction.idempotencyKey,
      walletId: transaction.walletId,
      playerId: transaction.playerId,
      roundId: transaction.roundId,
      gameId: transaction.gameId,
      kind: transaction.kind,
      amount: transaction.money.toString(),
      currency: transaction.money.currency,
      referenceExternalTransactionId:
        transaction.referenceExternalTransactionId,
    };
  }
}
