import { describe, expect, it } from "bun:test";
import { PendingReferenceWorker } from "../../src/infrastructure/messaging/PendingReferenceWorker";

describe("Worker: PendingReferenceWorker", () => {
  it("reprocessa transações pendentes usando o payload persistido", async () => {
    const transaction = {
      id: "tx-1",
      providerId: "provider",
      externalTransactionId: "refund-1",
      idempotencyKey: "idem-1",
      walletId: "wallet-1",
      playerId: "player-1",
      roundId: "round-1",
      gameId: "game-1",
      kind: "REFUND",
      money: { toString: () => "10.00", currency: "BRL" },
      referenceExternalTransactionId: "bet-1",
      createdAt: new Date(0),
    } as any;
    let command: any;
    const repository = {
      findPendingReferenceTransactions: async (limit: number) => {
        expect(limit).toBe(1);
        return [transaction];
      },
    } as any;
    const processWager = {
      execute: async (input: any) => {
        command = input;
        return { status: "PROCESSED" };
      },
    } as any;

    const worker = new PendingReferenceWorker(repository, processWager, {
      batchSize: 1,
      baseIntervalMs: 1,
    });

    expect(await worker.processBatch()).toBe(1);
    expect(command).toMatchObject({
      idempotencyKey: "idem-1",
      referenceExternalTransactionId: "bet-1",
      amount: "10.00",
      currency: "BRL",
    });
  });
});
