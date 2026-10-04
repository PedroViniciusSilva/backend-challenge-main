import { beforeEach, describe, expect, it } from "bun:test";
import { SqsConsumerWorker } from "../../src/infrastructure/messaging/SqsConsumerWorker";
import { SQSClient } from "@aws-sdk/client-sqs";
import { ProcessWagerUseCase } from "../../src/application/use-cases/ProcessWagerUseCase";
import {
  WagerTransactionKind,
  WagerTransactionStatus,
} from "../../src/domain/models/WagerTransaction";

describe("Worker: SqsConsumerWorker (Inbox Pattern)", () => {
  let mockEm: any;
  let mockSqs: any;
  let executedCommands: any[];
  let deletedReceipts: string[];
  let mockUseCase: any;

  beforeEach(() => {
    executedCommands = [];
    deletedReceipts = [];

    mockUseCase = {
      execute: async (cmd: any) => {
        executedCommands.push(cmd);
        return {
          transactionId: "tx-1",
          status: WagerTransactionStatus.Processed,
          walletId: cmd.walletId,
          currentBalance: "50.00",
          walletVersion: 2,
          isIdempotentReplay: false,
        };
      },
    } as unknown as ProcessWagerUseCase;

    mockEm = {
      fork: () => mockEm,
      findOne: async () => null, // Mensagem ainda não vista
    };

    mockSqs = {
      send: async (cmd: any) => {
        if (cmd.input?.ReceiptHandle && !cmd.input?.MessageBody) {
          deletedReceipts.push(cmd.input.ReceiptHandle);
        }
        return {
          Messages: [
            {
              MessageId: "sqs-msg-123",
              ReceiptHandle: "receipt-123",
              Body: JSON.stringify({
                providerId: "prv-1",
                externalTransactionId: "ext-tx-1",
                idempotencyKey: "idemp-1",
                walletId: "w-1",
                playerId: "p-1",
                roundId: "r-1",
                gameId: "g-1",
                kind: WagerTransactionKind.Bet,
                amount: "50.00",
                currency: "BRL",
              }),
            },
          ],
        };
      },
    } as unknown as SQSClient;
  });

  it("deve consumir mensagem do SQS, executar a aposta e deletar a mensagem da fila", async () => {
    const worker = new SqsConsumerWorker(mockEm, mockSqs, mockUseCase, {
      consumerName: "wagering-consumer",
      queueUrl: "http://localhost:4566/000000000000/wagering-events.fifo",
    });

    const processed = await worker.pollAndProcess(1);

    expect(processed).toBe(1);
    expect(executedCommands.length).toBe(1);
    expect(executedCommands[0].inboxMessage).toBeDefined();
    expect(executedCommands[0].inboxMessage.isProcessed()).toBe(true);
    expect(deletedReceipts).toContain("receipt-123");
  });

  it("deve descartar mensagens duplicadas já presentes no Inbox sem reprocessar", async () => {
    // Simula mensagem já marcada como processada no banco
    mockEm.findOne = async () => ({
      messageId: "sqs-msg-123",
      consumerName: "wagering-consumer",
      processedAt: new Date(),
    });

    const worker = new SqsConsumerWorker(mockEm, mockSqs, mockUseCase, {
      consumerName: "wagering-consumer",
      queueUrl: "http://localhost:4566/000000000000/wagering-events.fifo",
    });

    const processed = await worker.pollAndProcess(1);

    // Não deve executar a regra de negócio novamente
    expect(processed).toBe(0);
    expect(executedCommands.length).toBe(0);
    // Mas deve deletar do SQS para limpar a fila
    expect(deletedReceipts).toContain("receipt-123");
  });
});
