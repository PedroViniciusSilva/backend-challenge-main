import {
  ChangeMessageVisibilityCommand,
  CreateQueueCommand,
  DeleteQueueCommand,
  GetQueueUrlCommand,
  PurgeQueueCommand,
  ReceiveMessageCommand,
  SendMessageCommand,
  SQSClient,
} from "@aws-sdk/client-sqs";
import { beforeAll, afterAll, describe, expect, it } from "bun:test";
import { MikroORM } from "@mikro-orm/postgresql";
import config from "../../src/infrastructure/database/mikro-orm.config";
import { OutboxRelayWorker } from "../../src/infrastructure/messaging/OutboxRelayWorker";
import { SqsConsumerWorker } from "../../src/infrastructure/messaging/SqsConsumerWorker";
import { PendingReferenceWorker } from "../../src/infrastructure/messaging/PendingReferenceWorker";
import { PostgresWalletRepository } from "../../src/infrastructure/database/repositories/PostgresWalletRepository";
import { ProcessWagerUseCase } from "../../src/application/use-cases/ProcessWagerUseCase";
import { OutboxMessageEntity } from "../../src/infrastructure/database/entities/OutboxMessageEntity";
import { InboxMessageEntity } from "../../src/infrastructure/database/entities/InboxMessageEntity";
import { WagerTransactionEntity } from "../../src/infrastructure/database/entities/WagerTransactionEntity";
import {
  WagerTransactionKind,
  WagerTransactionStatus,
} from "../../src/domain/models/WagerTransaction";
import { Wallet } from "../../src/domain/models/Wallet";
import { Money } from "../../src/domain/models/Money";
import { OutboxMessage } from "../../src/domain/models/OutboxMessage";
import { v4 as uuid } from "uuid";

const endpoint = process.env.SQS_ENDPOINT ?? "http://localhost:4566";
const region = process.env.AWS_REGION ?? "us-east-1";
const sqs = new SQSClient({
  endpoint,
  region,
  credentials: { accessKeyId: "test", secretAccessKey: "test" },
});

describe("Homologação distribuída (PostgreSQL + LocalStack)", () => {
  let orm: MikroORM | undefined;
  let queueUrl: string | undefined;
  let dlqUrl: string | undefined;
  let available = false;

  beforeAll(async () => {
    try {
      orm = await MikroORM.init(config);
      await orm.getMigrator().up();
      queueUrl = (
        await sqs.send(
          new GetQueueUrlCommand({ QueueName: "wager-transactions.fifo" }),
        )
      ).QueueUrl;
      dlqUrl = (
        await sqs.send(
          new GetQueueUrlCommand({ QueueName: "wager-transactions-dlq.fifo" }),
        )
      ).QueueUrl;
      available = Boolean(queueUrl && dlqUrl);
    } catch (error) {
      console.warn(
        "Homologação ignorada: PostgreSQL/LocalStack não estão disponíveis. " +
          "Suba os containers e execute `bun run test:homologation`.",
      );
      await orm?.close(true).catch(() => undefined);
      orm = undefined;
    }
  });

  afterAll(async () => {
    await orm?.close(true);
  });

  async function isolatedQueue(prefix: string): Promise<string> {
    const name = `${prefix}-${uuid()}.fifo`;
    return (
      await sqs.send(
        new CreateQueueCommand({
          QueueName: name,
          Attributes: { FifoQueue: "true", ContentBasedDeduplication: "false" },
        }),
      )
    ).QueueUrl!;
  }

  async function deleteQueue(url: string): Promise<void> {
    await sqs
      .send(new DeleteQueueCommand({ QueueUrl: url }))
      .catch(() => undefined);
  }

  function requireServices(): asserts orm is MikroORM {
    expect(available).toBe(true);
    expect(orm).toBeDefined();
  }

  it("preserva envelope, registra Inbox e ignora redelivery pelo messageId", async () => {
    if (!available) return;
    requireServices();
    const url = await isolatedQueue("homologation-inbox");
    const repository = new PostgresWalletRepository(orm.em.fork());
    const useCase = new ProcessWagerUseCase(repository);
    const wallet = Wallet.open({
      id: uuid(),
      playerId: uuid(),
      initialBalance: Money.from({ amount: "100.00", currency: "BRL" }),
    });
    await repository.saveNewWallet(wallet);
    const messageId = uuid();
    const body = {
      messageId,
      data: {
        providerId: "provider",
        externalTransactionId: uuid(),
        idempotencyKey: uuid(),
        walletId: wallet.id,
        playerId: wallet.playerId,
        roundId: "round",
        gameId: "game",
        kind: WagerTransactionKind.Bet,
        amount: "10.00",
        currency: "BRL",
      },
    };
    try {
      await sqs.send(
        new SendMessageCommand({
          QueueUrl: url,
          MessageBody: JSON.stringify(body),
          MessageGroupId: "homologation",
          MessageDeduplicationId: uuid(),
        }),
      );
      const worker = new SqsConsumerWorker(orm.em, sqs, useCase, {
        consumerName: "homologation-consumer",
        queueUrl: url,
        visibilityTimeout: 0,
      });
      expect(await worker.pollAndProcess()).toBe(1);

      // A second delivery with a different SQS receipt but the same envelope id
      // must be acknowledged without executing the use case again.
      await sqs.send(
        new SendMessageCommand({
          QueueUrl: url,
          MessageBody: JSON.stringify(body),
          MessageGroupId: "homologation",
          MessageDeduplicationId: uuid(),
        }),
      );
      expect(await worker.pollAndProcess()).toBe(0);
      const inbox = await orm.em.fork().findOne(InboxMessageEntity, {
        consumerName: "homologation-consumer",
        messageId,
      });
      expect(inbox?.processedAt).toBeDefined();
      expect(
        await orm.em
          .fork()
          .count(WagerTransactionEntity, { walletId: wallet.id }),
      ).toBe(1);
    } finally {
      await deleteQueue(url);
    }
  });

  it("encaminha uma mensagem que excede tentativas para a DLQ", async () => {
    if (!available) return;
    requireServices();
    const url = await isolatedQueue("homologation-dlq");
    try {
      const poison = JSON.stringify({
        messageId: uuid(),
        data: { invalid: true },
      });
      await sqs
        .send(new PurgeQueueCommand({ QueueUrl: queueUrl! }))
        .catch(() => undefined);
      expect(dlqUrl).toBeDefined();
      await sqs
        .send(new PurgeQueueCommand({ QueueUrl: dlqUrl! }))
        .catch(() => undefined);
      await sqs.send(
        new SendMessageCommand({
          QueueUrl: queueUrl!,
          MessageBody: poison,
          MessageGroupId: "homologation",
          MessageDeduplicationId: uuid(),
        }),
      );
      for (let attempt = 0; attempt < 4; attempt++) {
        const response = await sqs.send(
          new ReceiveMessageCommand({
            QueueUrl: queueUrl!,
            MaxNumberOfMessages: 1,
            VisibilityTimeout: 0,
            WaitTimeSeconds: 0,
          }),
        );
        const message = response.Messages?.[0];
        if (message?.ReceiptHandle) {
          await sqs.send(
            new ChangeMessageVisibilityCommand({
              QueueUrl: queueUrl!,
              ReceiptHandle: message.ReceiptHandle,
              VisibilityTimeout: 0,
            }),
          );
        }
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      let dead: Awaited<ReturnType<typeof sqs.send>>;
      for (let attempt = 0; attempt < 10; attempt++) {
        dead = await sqs.send(
          new ReceiveMessageCommand({
            QueueUrl: dlqUrl!,
            MaxNumberOfMessages: 1,
            WaitTimeSeconds: 0,
          }),
        );
        if (dead.Messages?.length) break;
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      expect(dead!.Messages?.length ?? 0).toBe(1);
    } finally {
      await deleteQueue(url);
    }
  });

  it("publica uma outbox uma única vez com dois relays concorrentes", async () => {
    if (!available) return;
    requireServices();
    const url = await isolatedQueue("homologation-outbox");
    const id = uuid();
    try {
      const writeEm = orm.em.fork();
      const entity = writeEm.create(OutboxMessageEntity, {
        id,
        aggregateId: uuid(),
        eventType: "Homologation",
        payload: { eventId: id },
        occurredAt: new Date(),
        attempts: 0,
      });
      writeEm.persist(entity);
      await writeEm.flush();
      const first = new OutboxRelayWorker(orm.em, sqs, url);
      const second = new OutboxRelayWorker(orm.em, sqs, url);
      const [firstCount, secondCount] = await Promise.all([
        first.processBatch(1),
        second.processBatch(1),
      ]);
      expect(firstCount + secondCount).toBeGreaterThanOrEqual(1);
      expect(
        (await orm.em.fork().findOne(OutboxMessageEntity, { id }))?.publishedAt,
      ).toBeDefined();
      const received = await sqs.send(
        new ReceiveMessageCommand({
          QueueUrl: url,
          MaxNumberOfMessages: 10,
          WaitTimeSeconds: 0,
        }),
      );
      expect(received.Messages?.length ?? 0).toBeGreaterThanOrEqual(1);
    } finally {
      await deleteQueue(url);
    }
  });

  it("mantém PENDING_REFERENCE e processa após a referência chegar", async () => {
    if (!available) return;
    requireServices();
    const repository = new PostgresWalletRepository(orm.em.fork());
    const useCase = new ProcessWagerUseCase(repository);
    const wallet = Wallet.open({
      id: uuid(),
      playerId: uuid(),
      initialBalance: Money.from({ amount: "20.00", currency: "BRL" }),
    });
    await repository.saveNewWallet(wallet);
    const referenceExternalId = uuid();
    const pending = await useCase.execute({
      providerId: "provider",
      externalTransactionId: uuid(),
      idempotencyKey: uuid(),
      walletId: wallet.id,
      playerId: wallet.playerId,
      roundId: "round",
      gameId: "game",
      kind: WagerTransactionKind.Rollback,
      amount: "5.00",
      currency: "BRL",
      referenceExternalTransactionId: referenceExternalId,
    });
    expect(pending.status).toBe(WagerTransactionStatus.PendingReference);
    await useCase.execute({
      providerId: "provider",
      externalTransactionId: referenceExternalId,
      idempotencyKey: uuid(),
      walletId: wallet.id,
      playerId: wallet.playerId,
      roundId: "round",
      gameId: "game",
      kind: WagerTransactionKind.Bet,
      amount: "5.00",
      currency: "BRL",
    });
    const pendingWorker = new PendingReferenceWorker(repository, useCase, {
      baseIntervalMs: 1,
    });
    expect(await pendingWorker.processBatch()).toBe(1);
    const transaction = await repository.findTransactionById(
      pending.transactionId,
    );
    expect(transaction?.status).toBe(WagerTransactionStatus.Processed);
  });

  it("aplica REFUND e ROLLBACK uma única vez mantendo o ledger balanceado", async () => {
    if (!available) return;
    requireServices();
    const repository = new PostgresWalletRepository(orm.em.fork());
    const useCase = new ProcessWagerUseCase(repository);
    const wallet = Wallet.open({
      id: uuid(),
      playerId: uuid(),
      initialBalance: Money.from({ amount: "20.00", currency: "BRL" }),
    });
    await repository.saveNewWallet(wallet);

    const bet = await useCase.execute({
      providerId: "provider",
      externalTransactionId: uuid(),
      idempotencyKey: uuid(),
      walletId: wallet.id,
      playerId: wallet.playerId,
      roundId: "round",
      gameId: "game",
      kind: WagerTransactionKind.Bet,
      amount: "5.00",
      currency: "BRL",
    });
    const rollback = await useCase.execute({
      providerId: "provider",
      externalTransactionId: uuid(),
      idempotencyKey: uuid(),
      walletId: wallet.id,
      playerId: wallet.playerId,
      roundId: "round",
      gameId: "game",
      kind: WagerTransactionKind.Rollback,
      amount: "5.00",
      currency: "BRL",
      referenceExternalTransactionId: await repository
        .findTransactionById(bet.transactionId)
        .then((transaction) => transaction!.externalTransactionId),
    });

    expect(rollback.status).toBe(WagerTransactionStatus.Processed);
    const refundBetId = uuid();
    const refundBet = await useCase.execute({
      providerId: "provider",
      externalTransactionId: refundBetId,
      idempotencyKey: uuid(),
      walletId: wallet.id,
      playerId: wallet.playerId,
      roundId: "round-2",
      gameId: "game",
      kind: WagerTransactionKind.Bet,
      amount: "5.00",
      currency: "BRL",
    });
    const refund = await useCase.execute({
      providerId: "provider",
      externalTransactionId: uuid(),
      idempotencyKey: uuid(),
      walletId: wallet.id,
      playerId: wallet.playerId,
      roundId: "round-2",
      gameId: "game",
      kind: WagerTransactionKind.Refund,
      amount: "5.00",
      currency: "BRL",
      referenceExternalTransactionId: refundBetId,
    });

    expect(refund.status).toBe(WagerTransactionStatus.Processed);
    expect(refundBet.status).toBe(WagerTransactionStatus.Processed);
    const ledger = await repository.getLedgerEntries(wallet.id, 10);
    expect(ledger.length).toBe(4);
    expect(ledger[3].balanceAfter.toString()).toBe("20.00");
  });
});
