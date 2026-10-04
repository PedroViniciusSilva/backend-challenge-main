import { describe, expect, it } from "bun:test";
import { Money } from "../../src/domain/models/Money";
import {
  CurrencyMismatchError,
  InvalidMoneyValueError,
} from "../../src/domain/errors/DomainError";

describe("Value Object: Money", () => {
  it("deve criar uma instancia valida de Money com 2 casas decimais", () => {
    const m = Money.from({ amount: "25.00", currency: "BRL" });
    expect(m.toString()).toBe("25.00");
    expect(m.currency).toBe("BRL");
    expect(m.toJSON()).toEqual({ amount: "25.00", currency: "BRL" });
  });

  it("deve normalizar valores com 1 casa decimal para 2 casas", () => {
    const m = Money.from({ amount: "10.5", currency: "BRL" });
    expect(m.toString()).toBe("10.50");
  });

  it("deve somar duas quantias da mesma moeda sem mutar as originais", () => {
    const m1 = Money.from({ amount: "10.00", currency: "BRL" });
    const m2 = Money.from({ amount: "5.50", currency: "BRL" });
    const result = m1.add(m2);

    expect(result.toString()).toBe("15.50");
    expect(m1.toString()).toBe("10.00");
    expect(m2.toString()).toBe("5.50");
  });

  it("deve subtrair duas quantias da mesma moeda", () => {
    const m1 = Money.from({ amount: "100.00", currency: "BRL" });
    const m2 = Money.from({ amount: "80.00", currency: "BRL" });
    const result = m1.subtract(m2);

    expect(result.toString()).toBe("20.00");
  });

  it("deve lancar CurrencyMismatchError ao somar moedas diferentes", () => {
    const brl = Money.from({ amount: "10.00", currency: "BRL" });
    const usd = Money.from({ amount: "10.00", currency: "USD" });

    expect(() => brl.add(usd)).toThrow(CurrencyMismatchError);
  });

  it("deve rejeitar valores com mais de 2 casas decimais na entrada", () => {
    expect(() => Money.from({ amount: "25.001", currency: "BRL" })).toThrow(
      InvalidMoneyValueError,
    );
  });

  it("deve rejeitar notacao cientifica", () => {
    expect(() => Money.from({ amount: "1e5", currency: "BRL" })).toThrow(
      InvalidMoneyValueError,
    );
  });

  it("deve rejeitar valores negativos na factory de entrada", () => {
    expect(() => Money.from({ amount: "-10.00", currency: "BRL" })).toThrow(
      InvalidMoneyValueError,
    );
  });

  it("deve rejeitar moedas com formato invalido", () => {
    expect(() => Money.from({ amount: "10.00", currency: "REAL" })).toThrow(
      InvalidMoneyValueError,
    );
  });
});
