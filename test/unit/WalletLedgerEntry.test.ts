import { describe, expect, it } from "bun:test";
import {
  WalletLedgerEntry,
  LedgerDirection,
} from "../../src/domain/models/WalletLedgerEntry";
import { Money } from "../../src/domain/models/Money";
import { UnbalancedLedgerEntryError } from "../../src/domain/errors/DomainError";

describe("Entity: WalletLedgerEntry", () => {
  it("deve registrar um lançamento de débito balanceado com sucesso", () => {
    const entry = WalletLedgerEntry.create({
      id: "ledger-1",
      walletId: "wallet-1",
      transactionId: "tx-1",
      direction: LedgerDirection.Debit,
      money: Money.from({ amount: "30.00", currency: "BRL" }),
      balanceBefore: Money.from({ amount: "100.00", currency: "BRL" }),
      balanceAfter: Money.from({ amount: "70.00", currency: "BRL" }),
    });

    expect(entry.id).toBe("ledger-1");
    expect(entry.direction).toBe(LedgerDirection.Debit);
    expect(entry.isBalanced()).toBe(true);
  });

  it("deve registrar um lançamento de crédito balanceado com sucesso", () => {
    const entry = WalletLedgerEntry.create({
      id: "ledger-2",
      walletId: "wallet-1",
      transactionId: "tx-2",
      direction: LedgerDirection.Credit,
      money: Money.from({ amount: "50.00", currency: "BRL" }),
      balanceBefore: Money.from({ amount: "70.00", currency: "BRL" }),
      balanceAfter: Money.from({ amount: "120.00", currency: "BRL" }),
    });

    expect(entry.direction).toBe(LedgerDirection.Credit);
    expect(entry.isBalanced()).toBe(true);
  });

  it("deve rejeitar lançamento onde a matemática de débito não fecha", () => {
    // 100 - 30 deveria ser 70, mas passamos 80
    expect(() =>
      WalletLedgerEntry.create({
        id: "ledger-err-1",
        walletId: "wallet-1",
        transactionId: "tx-err-1",
        direction: LedgerDirection.Debit,
        money: Money.from({ amount: "30.00", currency: "BRL" }),
        balanceBefore: Money.from({ amount: "100.00", currency: "BRL" }),
        balanceAfter: Money.from({ amount: "80.00", currency: "BRL" }),
      }),
    ).toThrow(UnbalancedLedgerEntryError);
  });

  it("deve rejeitar lançamento onde a matemática de crédito não fecha", () => {
    // 50 + 20 deveria ser 70, mas passamos 60
    expect(() =>
      WalletLedgerEntry.create({
        id: "ledger-err-2",
        walletId: "wallet-1",
        transactionId: "tx-err-2",
        direction: LedgerDirection.Credit,
        money: Money.from({ amount: "20.00", currency: "BRL" }),
        balanceBefore: Money.from({ amount: "50.00", currency: "BRL" }),
        balanceAfter: Money.from({ amount: "60.00", currency: "BRL" }),
      }),
    ).toThrow(UnbalancedLedgerEntryError);
  });
});
