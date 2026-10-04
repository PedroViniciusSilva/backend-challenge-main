import { beforeEach, describe, expect, it } from "bun:test";
import { OutboxRelayWorker } from "../../src/infrastructure/messaging/OutboxRelayWorker";
import { OutboxMessageEntity } from "../../src/infrastructure/database/entities/OutboxMessageEntity";
import { SQSClient } from "@aws-sdk/client-sqs";

describe("Worker: OutboxRelayWorker", () => {
  let fakeEntities: OutboxMessageEntity[];
  let sentPayloads: string[];
  let mockEm: any;
  let mockSqs: any;

  beforeEach(() => {
    sentPayloads = [];
    fakeEntities = [
      {
        id: "outbox-1",
        aggregateId: "wallet-1",
        eventType: "WalletBalanceChanged",
        payload: { walletId: "wallet-1", amount: "50.00" },
        occurredAt: new Date(),
        attempts: 0,
        publishedAt: undefined,
        nextAttemptAt: undefined,
      } as OutboxMessageEntity,
    ];

    mockEm = {
      fork: () => mockEm,
      find: async () => fakeEntities.filter((e) => !e.publishedAt),
      flush: async () => {},
    };

    mockSqs = {
      send: async (cmd: any) => {
        sentPayloads.push(cmd.input.MessageBody);
        return { MessageId: "sqs-assigned-id" };
      },
    } as unknown as SQSClient;
  });

  it("deve despachar eventos pendentes para a fila SQS e marcar como publicado", async () => {
    const worker = new OutboxRelayWorker(
      mockEm,
      mockSqs,
      "http://localhost:4566/000000000000/wagering-events.fifo",
    );

    const processed = await worker.processBatch(10);

    expect(processed).toBe(1);
    expect(sentPayloads.length).toBe(1);
    expect(fakeEntities[0].publishedAt).toBeDefined();
    expect(fakeEntities[0].attempts).toBe(0);
  });

  it("deve agendar retry exponencial caso o SQS falhe temporariamente", async () => {
    // Simula erro de comunicação com o SQS
    mockSqs.send = async () => {
      throw new Error("Falha de conexão com a AWS");
    };

    const worker = new OutboxRelayWorker(
      mockEm,
      mockSqs,
      "http://localhost:4566/000000000000/wagering-events.fifo",
    );

    const processed = await worker.processBatch(10);

    expect(processed).toBe(0);
    expect(fakeEntities[0].publishedAt).toBeUndefined();
    expect(fakeEntities[0].attempts).toBe(1);
    expect(fakeEntities[0].nextAttemptAt).toBeDefined();
  });
});
