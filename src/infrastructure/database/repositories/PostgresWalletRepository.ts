import { EntityManager, LockMode } from "@mikro-orm/postgresql";
import {
  IWalletRepository,
  SaveWagerAtomicParams,
} from "../../../application/ports/IWalletRepository";
import { Wallet } from "../../../domain/models/Wallet";
import { WalletLedgerEntry } from "../../../domain/models/WalletLedgerEntry";
import {
  WagerTransaction,
  WagerTransactionStatus,
} from "../../../domain/models/WagerTransaction";
import { OutboxMessage } from "../../../domain/models/OutboxMessage";
import { Money } from "../../../domain/models/Money";
import { WalletEntity } from "../entities/WalletEntity";
import { WalletLedgerEntryEntity } from "../entities/WalletLedgerEntryEntity";
import { WagerTransactionEntity } from "../entities/WagerTransactionEntity";
import { OutboxMessageEntity } from "../entities/OutboxMessageEntity";
import { InboxMessageEntity } from "../entities/InboxMessageEntity";

export class PostgresWalletRepository implements IWalletRepository {
  constructor(private readonly em: EntityManager) {}

  async transactional<T>(
    action: (repo: IWalletRepository) => Promise<T>,
  ): Promise<T> {
    return this.em.transactional(async (txEm) => {
      const txRepo = new PostgresWalletRepository(txEm);
      return action(txRepo);
    });
  }

  async findById(id: string, lock: boolean = false): Promise<Wallet | null> {
    const entity = await this.em.findOne(
      WalletEntity,
      { id },
      lock ? { lockMode: LockMode.PESSIMISTIC_WRITE } : undefined,
    );

    if (!entity) {
      return null;
    }

    return Wallet.rehydrate({
      id: entity.id,
      playerId: entity.playerId,
      currency: entity.currency,
      balance: Money.rehydrate(entity.balance, entity.currency),
      version: entity.version,
      createdAt: entity.createdAt,
      updatedAt: entity.updatedAt,
    });
  }

  async findByPlayerIdAndCurrency(
    playerId: string,
    currency: string,
  ): Promise<Wallet | null> {
    const entity = await this.em.findOne(WalletEntity, { playerId, currency });
    if (!entity) {
      return null;
    }

    return Wallet.rehydrate({
      id: entity.id,
      playerId: entity.playerId,
      currency: entity.currency,
      balance: Money.rehydrate(entity.balance, entity.currency),
      version: entity.version,
      createdAt: entity.createdAt,
      updatedAt: entity.updatedAt,
    });
  }

  async findTransactionByIdempotencyKey(
    key: string,
  ): Promise<WagerTransaction | null> {
    const entity = await this.em.findOne(WagerTransactionEntity, {
      idempotencyKey: key,
    });
    if (!entity) {
      return null;
    }

    return WagerTransaction.rehydrate({
      id: entity.id,
      providerId: entity.providerId,
      externalTransactionId: entity.externalTransactionId,
      idempotencyKey: entity.idempotencyKey,
      payloadHash: entity.payloadHash,
      walletId: entity.walletId,
      playerId: entity.playerId,
      roundId: entity.roundId,
      gameId: entity.gameId,
      kind: entity.kind,
      money: Money.rehydrate(entity.amount, entity.currency),
      referenceExternalTransactionId: entity.referenceExternalTransactionId,
      referenceTransactionId: entity.referenceTransactionId,
      failureCode: entity.failureCode,
      createdAt: entity.createdAt,
      status: entity.status,
      processedAt: entity.processedAt,
    });
  }

  async findTransactionById(id: string): Promise<WagerTransaction | null> {
    const entity = await this.em.findOne(WagerTransactionEntity, { id });
    if (!entity) {
      return null;
    }
    return WagerTransaction.rehydrate({
      id: entity.id,
      providerId: entity.providerId,
      externalTransactionId: entity.externalTransactionId,
      idempotencyKey: entity.idempotencyKey,
      payloadHash: entity.payloadHash,
      walletId: entity.walletId,
      playerId: entity.playerId,
      roundId: entity.roundId,
      gameId: entity.gameId,
      kind: entity.kind,
      money: Money.rehydrate(entity.amount, entity.currency),
      referenceExternalTransactionId: entity.referenceExternalTransactionId,
      referenceTransactionId: entity.referenceTransactionId,
      failureCode: entity.failureCode,
      createdAt: entity.createdAt,
      status: entity.status,
      processedAt: entity.processedAt,
    });
  }

  async findTransactionByExternalId(
    providerId: string,
    externalId: string,
  ): Promise<WagerTransaction | null> {
    const entity = await this.em.findOne(WagerTransactionEntity, {
      providerId,
      externalTransactionId: externalId,
    });

    if (!entity) {
      return null;
    }

    return WagerTransaction.rehydrate({
      id: entity.id,
      providerId: entity.providerId,
      externalTransactionId: entity.externalTransactionId,
      idempotencyKey: entity.idempotencyKey,
      payloadHash: entity.payloadHash,
      walletId: entity.walletId,
      playerId: entity.playerId,
      roundId: entity.roundId,
      gameId: entity.gameId,
      kind: entity.kind,
      money: Money.rehydrate(entity.amount, entity.currency),
      referenceExternalTransactionId: entity.referenceExternalTransactionId,
      referenceTransactionId: entity.referenceTransactionId,
      failureCode: entity.failureCode,
      createdAt: entity.createdAt,
      status: entity.status,
      processedAt: entity.processedAt,
    });
  }

  async findPendingReferenceTransactions(
    limit: number,
  ): Promise<WagerTransaction[]> {
    const entities = await this.em.find(
      WagerTransactionEntity,
      { status: WagerTransactionStatus.PendingReference },
      {
        orderBy: { createdAt: "ASC" },
        limit: Math.max(1, Math.min(limit, 100)),
      },
    );
    return entities.map((entity) =>
      WagerTransaction.rehydrate({
        id: entity.id,
        providerId: entity.providerId,
        externalTransactionId: entity.externalTransactionId,
        idempotencyKey: entity.idempotencyKey,
        payloadHash: entity.payloadHash,
        walletId: entity.walletId,
        playerId: entity.playerId,
        roundId: entity.roundId,
        gameId: entity.gameId,
        kind: entity.kind,
        money: Money.rehydrate(entity.amount, entity.currency),
        referenceExternalTransactionId: entity.referenceExternalTransactionId,
        referenceTransactionId: entity.referenceTransactionId,
        failureCode: entity.failureCode,
        createdAt: entity.createdAt,
        status: entity.status,
        processedAt: entity.processedAt,
      }),
    );
  }

  async getPendingReferenceRetry(
    transactionId: string,
  ): Promise<{ attempts: number; nextAttemptAt?: Date }> {
    const rows = await this.em
      .getConnection()
      .execute<{ attempts: number; next_attempt_at: Date }[]>(
        `SELECT attempts, next_attempt_at FROM pending_reference_retries WHERE transaction_id = ?`,
        [transactionId],
      );
    const row = rows[0];
    return row
      ? { attempts: Number(row.attempts), nextAttemptAt: row.next_attempt_at }
      : { attempts: 0 };
  }

  async savePendingReferenceRetry(
    transactionId: string,
    attempts: number,
    nextAttemptAt: Date,
  ): Promise<void> {
    await this.em.getConnection().execute(
      `INSERT INTO pending_reference_retries (transaction_id, attempts, next_attempt_at)
       VALUES (?, ?, ?)
       ON CONFLICT (transaction_id) DO UPDATE
       SET attempts = EXCLUDED.attempts, next_attempt_at = EXCLUDED.next_attempt_at`,
      [transactionId, attempts, nextAttemptAt],
    );
  }

  async clearPendingReferenceRetry(transactionId: string): Promise<void> {
    await this.em
      .getConnection()
      .execute(
        `DELETE FROM pending_reference_retries WHERE transaction_id = ?`,
        [transactionId],
      );
  }

  async findReversalByReference(
    referenceTransactionId: string,
    kind: WagerTransaction["kind"],
  ): Promise<WagerTransaction | null> {
    const entity = await this.em.findOne(WagerTransactionEntity, {
      referenceTransactionId,
      kind,
    });
    if (!entity) {
      return null;
    }
    return WagerTransaction.rehydrate({
      id: entity.id,
      providerId: entity.providerId,
      externalTransactionId: entity.externalTransactionId,
      idempotencyKey: entity.idempotencyKey,
      payloadHash: entity.payloadHash,
      walletId: entity.walletId,
      playerId: entity.playerId,
      roundId: entity.roundId,
      gameId: entity.gameId,
      kind: entity.kind,
      money: Money.rehydrate(entity.amount, entity.currency),
      referenceExternalTransactionId: entity.referenceExternalTransactionId,
      referenceTransactionId: entity.referenceTransactionId,
      failureCode: entity.failureCode,
      createdAt: entity.createdAt,
      status: entity.status,
      processedAt: entity.processedAt,
    });
  }

  async saveNewWallet(
    wallet: Wallet,
    ledgerEntry?: WalletLedgerEntry,
    outboxMessage?: OutboxMessage,
  ): Promise<void> {
    const run = async (em: EntityManager) => {
      const walletEntity = em.create(WalletEntity, {
        id: wallet.id,
        playerId: wallet.playerId,
        currency: wallet.currency,
        balance: wallet.balance.toString(),
        version: wallet.version,
        createdAt: wallet.createdAt,
        updatedAt: wallet.updatedAt,
      });
      em.persist(walletEntity);

      await em.flush();

      if (ledgerEntry) {
        const ledgerEntity = em.create(WalletLedgerEntryEntity, {
          id: ledgerEntry.id,
          walletId: ledgerEntry.walletId,
          transactionId: ledgerEntry.transactionId,
          direction: ledgerEntry.direction,
          amount: ledgerEntry.money.toString(),
          currency: ledgerEntry.money.currency,
          balanceBefore: ledgerEntry.balanceBefore.toString(),
          balanceAfter: ledgerEntry.balanceAfter.toString(),
          createdAt: ledgerEntry.createdAt,
        });
        em.persist(ledgerEntity);
      }

      if (outboxMessage) {
        const outboxEntity = em.create(OutboxMessageEntity, {
          id: outboxMessage.id,
          aggregateId: outboxMessage.aggregateId,
          eventType: outboxMessage.eventType,
          payload: outboxMessage.payload,
          occurredAt: outboxMessage.occurredAt,
          attempts: outboxMessage.attempts,
          nextAttemptAt: outboxMessage.nextAttemptAt,
          publishedAt: outboxMessage.publishedAt,
          claimToken: undefined,
          claimUntil: undefined,
        });
        em.persist(outboxEntity);
      }
      await em.flush();
    };

    if (this.em.isInTransaction()) {
      await run(this.em);
    } else {
      await this.em.transactional(run);
    }
  }

  async saveWagerAtomic(params: SaveWagerAtomicParams): Promise<void> {
    const run = async (em: EntityManager) => {
      const walletEntity = await em.findOneOrFail(WalletEntity, {
        id: params.wallet.id,
      });
      walletEntity.balance = params.wallet.balance.toString();
      walletEntity.version = params.wallet.version;
      walletEntity.updatedAt = params.wallet.updatedAt;

      const txEntity =
        (await em.findOne(WagerTransactionEntity, {
          id: params.transaction.id,
        })) ??
        em.create(WagerTransactionEntity, {
          id: params.transaction.id,
          providerId: params.transaction.providerId,
          externalTransactionId: params.transaction.externalTransactionId,
          idempotencyKey: params.transaction.idempotencyKey,
          payloadHash: params.transaction.payloadHash,
          walletId: params.transaction.walletId,
          playerId: params.transaction.playerId,
          roundId: params.transaction.roundId,
          gameId: params.transaction.gameId,
          kind: params.transaction.kind,
          amount: params.transaction.money.toString(),
          currency: params.transaction.money.currency,
          status: params.transaction.status,
          referenceExternalTransactionId:
            params.transaction.referenceExternalTransactionId,
          referenceTransactionId: params.transaction.referenceTransactionId,
          failureCode: params.transaction.failureCode,
          createdAt: params.transaction.createdAt,
          processedAt: params.transaction.processedAt,
        });
      txEntity.providerId = params.transaction.providerId;
      txEntity.externalTransactionId = params.transaction.externalTransactionId;
      txEntity.idempotencyKey = params.transaction.idempotencyKey;
      txEntity.payloadHash = params.transaction.payloadHash;
      txEntity.walletId = params.transaction.walletId;
      txEntity.playerId = params.transaction.playerId;
      txEntity.roundId = params.transaction.roundId;
      txEntity.gameId = params.transaction.gameId;
      txEntity.kind = params.transaction.kind;
      txEntity.amount = params.transaction.money.toString();
      txEntity.currency = params.transaction.money.currency;
      txEntity.status = params.transaction.status;
      txEntity.referenceExternalTransactionId =
        params.transaction.referenceExternalTransactionId;
      txEntity.referenceTransactionId =
        params.transaction.referenceTransactionId;
      txEntity.failureCode = params.transaction.failureCode;
      txEntity.processedAt = params.transaction.processedAt;
      em.persist(txEntity);

      if (params.ledgerEntry) {
        const ledgerEntity = em.create(WalletLedgerEntryEntity, {
          id: params.ledgerEntry.id,
          walletId: params.ledgerEntry.walletId,
          transactionId: params.ledgerEntry.transactionId,
          direction: params.ledgerEntry.direction,
          amount: params.ledgerEntry.money.toString(),
          currency: params.ledgerEntry.money.currency,
          balanceBefore: params.ledgerEntry.balanceBefore.toString(),
          balanceAfter: params.ledgerEntry.balanceAfter.toString(),
          createdAt: params.ledgerEntry.createdAt,
        });
        em.persist(ledgerEntity);
      }

      for (const msg of params.outboxMessages) {
        const outboxEntity = em.create(OutboxMessageEntity, {
          id: msg.id,
          aggregateId: msg.aggregateId,
          eventType: msg.eventType,
          payload: msg.payload,
          occurredAt: msg.occurredAt,
          attempts: msg.attempts,
          nextAttemptAt: msg.nextAttemptAt,
          publishedAt: msg.publishedAt,
          claimToken: undefined,
          claimUntil: undefined,
        });
        em.persist(outboxEntity);
      }

      if (params.inboxMessage) {
        const inboxEntity = em.create(InboxMessageEntity, {
          messageId: params.inboxMessage.messageId,
          consumerName: params.inboxMessage.consumerName,
          payloadHash: params.inboxMessage.payloadHash,
          receivedAt: params.inboxMessage.receivedAt,
          processedAt: params.inboxMessage.processedAt,
        });
        em.persist(inboxEntity);
      }

      await em.flush();
    };

    if (this.em.isInTransaction()) {
      await run(this.em);
    } else {
      await this.em.transactional(run);
    }
  }

  async getLedgerEntries(
    walletId: string,
    limit: number,
    cursor?: string,
  ): Promise<WalletLedgerEntry[]> {
    const qb = this.em
      .createQueryBuilder(WalletLedgerEntryEntity, "l")
      .where({ walletId })
      .orderBy({ createdAt: "ASC" })
      .limit(limit);

    if (cursor) {
      qb.andWhere("l.created_at > ?", [new Date(cursor)]);
    }

    const entities = await qb.getResultList();

    return entities.map((e) =>
      WalletLedgerEntry.rehydrate({
        id: e.id,
        walletId: e.walletId,
        transactionId: e.transactionId,
        direction: e.direction,
        money: Money.rehydrate(e.amount, e.currency),
        balanceBefore: Money.rehydrate(e.balanceBefore, e.currency),
        balanceAfter: Money.rehydrate(e.balanceAfter, e.currency),
        createdAt: e.createdAt,
      }),
    );
  }
}
