import { Injectable, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { EntityManager } from "@mikro-orm/postgresql";
import { SQSClient } from "@aws-sdk/client-sqs";
import { ProcessWagerUseCase } from "../../application/use-cases/ProcessWagerUseCase";
import { OutboxRelayWorker } from "./OutboxRelayWorker";
import { SqsConsumerWorker } from "./SqsConsumerWorker";
import { PendingReferenceWorker } from "./PendingReferenceWorker";
import type { IWalletRepository } from "../../application/ports/IWalletRepository";
import { MetricsService } from "../observability/MetricsService";

@Injectable()
export class MessagingWorkersManager implements OnModuleInit, OnModuleDestroy {
  private readonly consumer: SqsConsumerWorker;
  private readonly relay: OutboxRelayWorker;
  private readonly pendingReference: PendingReferenceWorker;

  constructor(
    em: EntityManager,
    sqsClient: SQSClient,
    processWager: ProcessWagerUseCase,
    repository: IWalletRepository,
    metrics: MetricsService,
  ) {
    const queueUrl = process.env.SQS_QUEUE_URL;
    const configuredQueueUrl =
      queueUrl || "http://localhost:4566/000000000000/wager-transactions.fifo";
    this.consumer = new SqsConsumerWorker(
      em,
      sqsClient,
      processWager,
      {
        consumerName: process.env.SQS_CONSUMER_NAME || "wager-processor",
        queueUrl: configuredQueueUrl,
        visibilityTimeout: Number(process.env.SQS_VISIBILITY_TIMEOUT || 30),
      },
      metrics,
    );
    this.relay = new OutboxRelayWorker(
      em,
      sqsClient,
      configuredQueueUrl,
      metrics,
    );
    this.pendingReference = new PendingReferenceWorker(
      repository,
      processWager,
      {
        batchSize: Number(process.env.PENDING_REFERENCE_BATCH_SIZE || 10),
        baseIntervalMs: Number(
          process.env.PENDING_REFERENCE_INTERVAL_MS || 1000,
        ),
      },
    );
  }

  onModuleInit(): void {
    if (process.env.RUN_MESSAGING_WORKERS === "true") {
      this.pendingReference.start();
      if (process.env.SQS_QUEUE_URL) {
        this.consumer.start();
        this.relay.start();
      }
    }
  }

  async onModuleDestroy(): Promise<void> {
    await Promise.all([
      this.consumer.stop(),
      this.relay.stop(),
      this.pendingReference.stop(),
    ]);
  }
}
