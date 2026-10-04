import { describe, expect, it } from "bun:test";
import { Wallet } from "../../src/domain/models/Wallet";
import { Money } from "../../src/domain/models/Money";
import {
  CurrencyMismatchError,
  InsufficientFundsError,
} from "../../src/domain/errors/DomainError";

describe("Aggregate Root: Wallet", () => {
  it("deve abrir uma nova wallet com versão inicial 1", () => {
    const initialBalance = Money.from({ amount: "100.00", currency: "BRL" });
    const wallet = Wallet.open({
      id: "wallet-1",
      playerId: "player-1",
      initialBalance,
    });

    expect(wallet.id).toBe("wallet-1");
    expect(wallet.playerId).toBe("player-1");
    expect(wallet.currency).toBe("BRL");
    expect(wallet.balance.toString()).toBe("100.00");
    expect(wallet.version).toBe(1);
  });

  it("deve debitar saldo com sucesso e avançar a versão para 2", () => {
    const wallet = Wallet.open({
      id: "wallet-1",
      playerId: "player-1",
      initialBalance: Money.from({ amount: "100.00", currency: "BRL" }),
    });

    const debitAmount = Money.from({ amount: "30.00", currency: "BRL" });
    wallet.debit(debitAmount);

    expect(wallet.balance.toString()).toBe("70.00");
    expect(wallet.version).toBe(2);
  });

  it("deve creditar saldo com sucesso e avançar a versão para 2", () => {
    const wallet = Wallet.open({
      id: "wallet-1",
      playerId: "player-1",
      initialBalance: Money.from({ amount: "50.00", currency: "BRL" }),
    });

    const creditAmount = Money.from({ amount: "25.50", currency: "BRL" });
    wallet.credit(creditAmount);

    expect(wallet.balance.toString()).toBe("75.50");
    expect(wallet.version).toBe(2);
  });

  it("deve recusar débito se o saldo for menor que o valor solicitado", () => {
    const wallet = Wallet.open({
      id: "wallet-1",
      playerId: "player-1",
      initialBalance: Money.from({ amount: "100.00", currency: "BRL" }),
    });

    const debitAttempt = Money.from({ amount: "100.01", currency: "BRL" });

    expect(() => wallet.debit(debitAttempt)).toThrow(InsufficientFundsError);
    // O saldo e a versão não podem ter sido alterados
    expect(wallet.balance.toString()).toBe("100.00");
    expect(wallet.version).toBe(1);
  });

  it("deve rejeitar movimentação com moeda diferente da carteira", () => {
    const wallet = Wallet.open({
      id: "wallet-1",
      playerId: "player-1",
      initialBalance: Money.from({ amount: "100.00", currency: "BRL" }),
    });

    const usdDebit = Money.from({ amount: "10.00", currency: "USD" });
    expect(() => wallet.debit(usdDebit)).toThrow(CurrencyMismatchError);
  });
});
