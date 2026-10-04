import { describe, expect, it } from "bun:test";
import {
  WagerTransaction,
  WagerTransactionKind,
  WagerTransactionStatus,
} from "../../src/domain/models/WagerTransaction";
import { LedgerDirection } from "../../src/domain/models/WalletLedgerEntry";
import { Money } from "../../src/domain/models/Money";
import {
  FailureCode,
  InvalidTransactionStateError,
  InvalidMoneyValueError,
} from "../../src/domain/errors/DomainError";

describe("Entity: WagerTransaction", () => {
  const baseMoney = Money.from({ amount: "50.00", currency: "BRL" });

  it("deve nascer no status PENDING", () => {
    const tx = WagerTransaction.create({
      id: "tx-1",
      providerId: "prv-1",
      externalTransactionId: "ext-1",
      idempotencyKey: "prv-1:ext-1",
      payloadHash: "hash123",
      walletId: "w-1",
      playerId: "p-1",
      roundId: "r-1",
      gameId: "game-1",
      kind: WagerTransactionKind.Bet,
      money: baseMoney,
    });

    expect(tx.status).toBe(WagerTransactionStatus.Pending);
    expect(tx.isTerminal()).toBe(false);
    expect(tx.affectsBalance()).toBe(true);
    expect(tx.ledgerDirectionFor()).toBe(LedgerDirection.Debit);
  });

  it("deve marcar como PROCESSED e virar terminal", () => {
    const tx = WagerTransaction.create({
      id: "tx-2",
      providerId: "prv-1",
      externalTransactionId: "ext-2",
      idempotencyKey: "prv-1:ext-2",
      payloadHash: "hash123",
      walletId: "w-1",
      playerId: "p-1",
      roundId: "r-1",
      gameId: "game-1",
      kind: WagerTransactionKind.Win,
      money: baseMoney,
    });

    tx.markProcessed(undefined);

    expect(tx.status).toBe(WagerTransactionStatus.Processed);
    expect(tx.isTerminal()).toBe(true);
    expect(tx.ledgerDirectionFor()).toBe(LedgerDirection.Credit);
  });

  it("deve proibir qualquer nova transição após virar terminal", () => {
    const tx = WagerTransaction.create({
      id: "tx-3",
      providerId: "prv-1",
      externalTransactionId: "ext-3",
      idempotencyKey: "prv-1:ext-3",
      payloadHash: "hash123",
      walletId: "w-1",
      playerId: "p-1",
      roundId: "r-1",
      gameId: "game-1",
      kind: WagerTransactionKind.Bet,
      money: baseMoney,
    });

    tx.reject(FailureCode.InsufficientFunds);

    expect(tx.status).toBe(WagerTransactionStatus.Rejected);
    expect(tx.isTerminal()).toBe(true);

    // Tentar processar algo já rejeitado deve estourar erro imediatamente
    expect(() => tx.markProcessed(undefined)).toThrow(
      InvalidTransactionStateError,
    );
  });

  it("deve exigir referência externa para REFUND", () => {
    expect(() =>
      WagerTransaction.create({
        id: "tx-4",
        providerId: "prv-1",
        externalTransactionId: "ext-4",
        idempotencyKey: "prv-1:ext-4",
        payloadHash: "hash123",
        walletId: "w-1",
        playerId: "p-1",
        roundId: "r-1",
        gameId: "game-1",
        kind: WagerTransactionKind.Refund,
        money: baseMoney,
        // Sem referenceExternalTransactionId
      }),
    ).toThrow(InvalidMoneyValueError);
  });

  it("deve inverter a direção da transação original ao fazer ROLLBACK", () => {
    const betTx = WagerTransaction.create({
      id: "tx-bet",
      providerId: "prv-1",
      externalTransactionId: "ext-bet",
      idempotencyKey: "prv-1:ext-bet",
      payloadHash: "hash123",
      walletId: "w-1",
      playerId: "p-1",
      roundId: "r-1",
      gameId: "game-1",
      kind: WagerTransactionKind.Bet,
      money: baseMoney,
    });

    const rollbackTx = WagerTransaction.create({
      id: "tx-rb",
      providerId: "prv-1",
      externalTransactionId: "ext-rb",
      idempotencyKey: "prv-1:ext-rb",
      payloadHash: "hash123",
      walletId: "w-1",
      playerId: "p-1",
      roundId: "r-1",
      gameId: "game-1",
      kind: WagerTransactionKind.Rollback,
      money: baseMoney,
      referenceExternalTransactionId: "ext-bet",
    });

    // Se a aposta original foi DÉBITO, o rollback dela tem que ser CRÉDITO
    expect(rollbackTx.ledgerDirectionFor(betTx)).toBe(LedgerDirection.Credit);
  });
});
