import {
  ChangeMessageVisibilityCommand,
  DeleteMessageCommand,
  ReceiveMessageCommand,
  SQSClient,
} from "@aws-sdk/client-sqs";
import { EntityManager } from "@mikro-orm/postgresql";
import { InboxMessageEntity } from "../database/entities/InboxMessageEntity";
import { InboxMessage } from "../../domain/models/InboxMessage";
import {
  ProcessWagerUseCase,
  ProcessWagerCommand,
} from "../../application/use-cases/ProcessWagerUseCase";
import { calculatePayloadHash } from "../../application/utils/CanonicalJson";
import { MetricsService } from "../observability/MetricsService";

export interface SqsConsumerOptions {
  consumerName: string;
  queueUrl: string;
  visibilityTimeout?: number;
}

export class SqsConsumerWorker {
  private running = false;
  private polling?: Promise<void>;
  private readonly activeReceipts = new Set<string>();

  constructor(
    private readonly em: EntityManager,
    private readonly sqsClient: SQSClient,
    private readonly processWagerUseCase: ProcessWagerUseCase,
    private readonly options: SqsConsumerOptions,
    private readonly metrics?: MetricsService,
  ) {}

  start(intervalMs = 1000): void {
    if (this.running) return;
    this.running = true;
    this.polling = this.run(intervalMs);
  }

  async stop(): Promise<void> {
    this.running = false;
    await Promise.all(
      [...this.activeReceipts].map((receiptHandle) =>
        this.returnVisibility(receiptHandle),
      ),
    );
    await this.polling;
  }

  private async run(intervalMs: number): Promise<void> {
    while (this.running) {
      try {
        await this.pollAndProcess();
      } catch {
        await new Promise((resolve) => setTimeout(resolve, intervalMs));
      }
    }
  }

  async pollAndProcess(maxMessages: number = 10): Promise<number> {
    const receiveCommand = new ReceiveMessageCommand({
      QueueUrl: this.options.queueUrl,
      MaxNumberOfMessages: Math.min(maxMessages, 10),
      VisibilityTimeout: this.options.visibilityTimeout ?? 30,
      WaitTimeSeconds: 0,
    });

    const response = await this.sqsClient.send(receiveCommand);
    const messages = response.Messages ?? [];

    if (messages.length === 0) {
      return 0;
    }

    let processedCount = 0;

    for (const message of messages) {
      if (!message.ReceiptHandle || !message.Body) {
        continue;
      }
      this.activeReceipts.add(message.ReceiptHandle);

      const fork = this.em.fork();

      try {
        const receiveCount = Number(
          message.Attributes?.ApproximateReceiveCount ?? 1,
        );
        if (receiveCount >= 3) {
          this.metrics?.increment("messages_dlq");
        }
        const envelope = JSON.parse(message.Body) as {
          messageId?: string;
          data?: Record<string, unknown>;
        };
        const messageId =
          envelope.messageId ?? message.MessageId ?? message.ReceiptHandle;
        const payload = (envelope.data ?? envelope) as ProcessWagerCommand & {
          money?: { amount: string; currency: string };
        };
        const amount = payload.money?.amount ?? payload.amount;
        const currency = payload.money?.currency ?? payload.currency;
        const payloadHash = calculatePayloadHash(payload);

        const existingInbox = await fork.findOne(InboxMessageEntity, {
          consumerName: this.options.consumerName,
          messageId,
        });

        if (existingInbox && existingInbox.processedAt) {
          await this.deleteFromQueue(message.ReceiptHandle);
          continue;
        }

        const inboxModel = InboxMessage.receive({
          messageId,
          consumerName: this.options.consumerName,
          payloadHash,
        });

        const command: ProcessWagerCommand = {
          providerId: payload.providerId,
          externalTransactionId: payload.externalTransactionId,
          idempotencyKey: payload.idempotencyKey,
          walletId: payload.walletId,
          playerId: payload.playerId,
          roundId: payload.roundId,
          gameId: payload.gameId,
          kind: payload.kind,
          amount,
          currency,
          referenceExternalTransactionId:
            payload.referenceExternalTransactionId,
          inboxMessage: inboxModel,
          correlationId: payload.correlationId,
        };

        inboxModel.markProcessed(new Date());
        await this.processWagerUseCase.execute(command);

        if (process.env.CRASH_AFTER_COMMIT_BEFORE_ACK === "true") {
          console.error(
            JSON.stringify({
              event: "intentional_crash_after_commit",
              worker: "sqs-consumer",
              messageId,
            }),
          );
          process.exit(137);
        }

        await this.deleteFromQueue(message.ReceiptHandle);
        processedCount++;
        this.metrics?.increment("transactions_processed");
        this.log("message_processed", {
          messageId,
          correlationId: payload.correlationId,
        });
      } catch (error) {
        this.metrics?.increment("message_retries");
        this.log("message_retry", {
          messageId: message.MessageId ?? message.ReceiptHandle,
          error: error instanceof Error ? error.name : "unknown",
        });
        try {
          await this.returnVisibility(message.ReceiptHandle, 5);
        } catch {}
      } finally {
        this.activeReceipts.delete(message.ReceiptHandle);
      }
    }

    return processedCount;
  }

  private async deleteFromQueue(receiptHandle: string): Promise<void> {
    await this.sqsClient.send(
      new DeleteMessageCommand({
        QueueUrl: this.options.queueUrl,
        ReceiptHandle: receiptHandle,
      }),
    );
  }

  private async returnVisibility(
    receiptHandle: string,
    visibilityTimeout = 0,
  ): Promise<void> {
    await this.sqsClient.send(
      new ChangeMessageVisibilityCommand({
        QueueUrl: this.options.queueUrl,
        ReceiptHandle: receiptHandle,
        VisibilityTimeout: visibilityTimeout,
      }),
    );
  }

  private log(event: string, fields: Record<string, string | undefined>): void {
    console.log(JSON.stringify({ event, worker: "sqs-consumer", ...fields }));
  }
}
