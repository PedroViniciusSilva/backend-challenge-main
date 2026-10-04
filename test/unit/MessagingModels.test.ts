import { describe, expect, it } from "bun:test";
import { InboxMessage } from "../../src/domain/models/InboxMessage";
import { OutboxMessage } from "../../src/domain/models/OutboxMessage";
import { WalletBalanceChanged } from "../../src/domain/events/DomainEvents";
import { LedgerDirection } from "../../src/domain/models/WalletLedgerEntry";

describe("Messaging: Inbox and Outbox Models", () => {
  it("deve registrar mensagem no Inbox e carimbar como processada", () => {
    const inbox = InboxMessage.receive({
      messageId: "sqs-msg-123",
      consumerName: "wager-worker",
      payloadHash: "hash-abc",
    });

    expect(inbox.isProcessed()).toBe(false);

    inbox.markProcessed();
    expect(inbox.isProcessed()).toBe(true);
    expect(inbox.processedAt).toBeDefined();
  });

  it("deve enfileirar evento de integração no Outbox e calcular backoff de retry", () => {
    const event = new WalletBalanceChanged({
      eventId: "evt-1",
      aggregateId: "wallet-1",
      correlationId: "corr-1",
      occurredAt: new Date(),
      data: {
        walletId: "wallet-1",
        transactionId: "tx-1",
        direction: LedgerDirection.Debit,
        money: { amount: "10.00", currency: "BRL" },
        balanceBefore: { amount: "100.00", currency: "BRL" },
        balanceAfter: { amount: "90.00", currency: "BRL" },
        walletVersion: 2,
      },
    });

    const outbox = OutboxMessage.enqueue(event);

    expect(outbox.isPending()).toBe(true);
    expect(outbox.attempts).toBe(0);
    expect(outbox.isDue()).toBe(true);

    // Simula falha temporária e agenda retry
    const now = new Date();
    outbox.scheduleRetry(now);

    expect(outbox.attempts).toBe(1);
    expect(outbox.nextAttemptAt).toBeDefined();
    // 2^1 = 2 segundos no futuro
    expect(outbox.nextAttemptAt!.getTime()).toBeGreaterThan(now.getTime());

    // Marca como publicado
    outbox.markPublished();
    expect(outbox.isPending()).toBe(false);
    expect(outbox.isDue()).toBe(false);
  });
});
