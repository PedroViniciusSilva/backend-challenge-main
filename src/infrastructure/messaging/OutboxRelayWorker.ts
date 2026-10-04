import { EntityManager } from "@mikro-orm/postgresql";
import { SendMessageCommand, SQSClient } from "@aws-sdk/client-sqs";
import { OutboxMessageEntity } from "../database/entities/OutboxMessageEntity";
import { OutboxMessage } from "../../domain/models/OutboxMessage";
import { randomUUID } from "crypto";
import { MetricsService } from "../observability/MetricsService";

export class OutboxRelayWorker {
  private running = false;
  private polling?: Promise<void>;

  constructor(
    private readonly em: EntityManager,
    private readonly sqsClient: SQSClient,
    private readonly queueUrl: string,
    private readonly metrics?: MetricsService,
  ) {}

  start(intervalMs = 1000): void {
    if (this.running) return;
    this.running = true;
    this.polling = this.run(intervalMs);
  }

  async stop(): Promise<void> {
    this.running = false;
    await this.polling;
  }

  private async run(intervalMs: number): Promise<void> {
    while (this.running) {
      try {
        await this.processBatch();
      } catch {
        await new Promise((resolve) => setTimeout(resolve, intervalMs));
      }
      if (this.running) {
        await new Promise((resolve) => setTimeout(resolve, intervalMs));
      }
    }
  }

  async processBatch(batchSize: number = 10): Promise<number> {
    const fork = this.em.fork();
    const now = new Date();
    const claimToken = randomUUID();
    const claimUntil = new Date(now.getTime() + 30_000);

    const connection = fork.getConnection?.();
    if (!connection) {
      return this.processWithoutClaim(fork, batchSize, now);
    }
    const claimed = await fork.transactional(async (transactionEm) => {
      const transactionConnection = transactionEm.getConnection();
      // Serialize the short claim section across relay instances. The row
      // locks still allow independent workers to publish different batches,
      // while avoiding a snapshot race between candidate selection and UPDATE.
      await transactionConnection.execute(
        `SELECT pg_advisory_xact_lock(hashtextextended('outbox-relay-claim', 0))`,
      );
      const candidates = await transactionConnection.execute<{ id: string }[]>(
        `
        SELECT id
        FROM outbox_messages
        WHERE published_at IS NULL
          AND (next_attempt_at IS NULL OR next_attempt_at <= CURRENT_TIMESTAMP)
          AND (claim_until IS NULL OR claim_until < CURRENT_TIMESTAMP)
        ORDER BY occurred_at ASC
        LIMIT ${Math.max(1, Math.min(batchSize, 100))}
        FOR UPDATE SKIP LOCKED
      `,
      );
      if (candidates.length === 0) return [];
      return transactionConnection.execute<{ id: string }[]>(
        `
        UPDATE outbox_messages
        SET claim_token = ?, claim_until = ?
        WHERE id IN (${candidates.map(() => "?").join(", ")})
        RETURNING id
      `,
        [claimToken, claimUntil, ...candidates.map((row) => row.id)],
      );
    });
    const entities = await fork.find(OutboxMessageEntity, {
      id: { $in: claimed.map((row) => row.id) },
    });
    this.metrics?.observeOutboxLag(entities.length);

    if (entities.length === 0) {
      return 0;
    }

    let processedCount = 0;

    for (const entity of entities) {
      const outbox = OutboxMessage.rehydrate({
        id: entity.id,
        aggregateId: entity.aggregateId,
        eventType: entity.eventType,
        payload: entity.payload,
        occurredAt: entity.occurredAt,
        attempts: entity.attempts,
        nextAttemptAt: entity.nextAttemptAt,
        publishedAt: entity.publishedAt,
      });

      try {
        const isFifo = this.queueUrl.endsWith(".fifo");

        const command = new SendMessageCommand({
          QueueUrl: this.queueUrl,
          MessageBody: JSON.stringify(outbox.payload),
          ...(isFifo
            ? {
                MessageGroupId: outbox.aggregateId,
                MessageDeduplicationId: outbox.id,
              }
            : {}),
        });

        await this.sqsClient.send(command);

        outbox.markPublished(new Date());
        entity.publishedAt = outbox.publishedAt;
        entity.claimToken = undefined;
        entity.claimUntil = undefined;
        processedCount++;
        console.log(
          JSON.stringify({
            event: "outbox_published",
            worker: "outbox-relay",
            transactionId: entity.id,
            aggregateId: entity.aggregateId,
          }),
        );
      } catch (error) {
        console.log(
          JSON.stringify({
            event: "outbox_retry",
            worker: "outbox-relay",
            transactionId: entity.id,
            error: error instanceof Error ? error.name : "unknown",
          }),
        );
        outbox.scheduleRetry(new Date());
        this.metrics?.increment("message_retries");
        entity.attempts = outbox.attempts;
        entity.nextAttemptAt = outbox.nextAttemptAt;
        entity.claimToken = undefined;
        entity.claimUntil = undefined;
      }
    }

    await fork.flush();

    return processedCount;
  }

  private async processWithoutClaim(
    fork: EntityManager,
    batchSize: number,
    now: Date,
  ): Promise<number> {
    const entities = await fork.find(
      OutboxMessageEntity,
      {
        publishedAt: null,
        $or: [{ nextAttemptAt: null }, { nextAttemptAt: { $lte: now } }],
      },
      { limit: batchSize, orderBy: { occurredAt: "ASC" } },
    );
    return this.publishEntities(fork, entities);
  }

  private async publishEntities(
    fork: EntityManager,
    entities: OutboxMessageEntity[],
  ): Promise<number> {
    let processedCount = 0;
    for (const entity of entities) {
      const outbox = OutboxMessage.rehydrate({
        id: entity.id,
        aggregateId: entity.aggregateId,
        eventType: entity.eventType,
        payload: entity.payload,
        occurredAt: entity.occurredAt,
        attempts: entity.attempts,
        nextAttemptAt: entity.nextAttemptAt,
        publishedAt: entity.publishedAt,
      });
      try {
        const isFifo = this.queueUrl.endsWith(".fifo");
        await this.sqsClient.send(
          new SendMessageCommand({
            QueueUrl: this.queueUrl,
            MessageBody: JSON.stringify(outbox.payload),
            ...(isFifo
              ? {
                  MessageGroupId: outbox.aggregateId,
                  MessageDeduplicationId: outbox.id,
                }
              : {}),
          }),
        );
        outbox.markPublished(new Date());
        entity.publishedAt = outbox.publishedAt;
        processedCount++;
      } catch {
        outbox.scheduleRetry(new Date());
        entity.attempts = outbox.attempts;
        entity.nextAttemptAt = outbox.nextAttemptAt;
      }
    }
    await fork.flush();
    return processedCount;
  }
}
