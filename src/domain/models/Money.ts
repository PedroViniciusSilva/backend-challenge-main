import Decimal from "decimal.js";
import {
  CurrencyMismatchError,
  InvalidMoneyValueError,
} from "../errors/DomainError";

Decimal.set({ precision: 20, rounding: Decimal.ROUND_HALF_UP });

export interface MoneyProps {
  amount: string; // Sempre string com 2 casas decimais, ex.: "25.00"
  currency: string; // ISO-4217, ex.: "BRL"
}

export class Money {
  private constructor(
    private readonly value: Decimal,
    public readonly currency: string,
  ) {}

  /**
   * Factory para criar Money a partir de entradas externas (API, DTO, Mensagens).
   * Valida rigorosamente as regras financeiras exigidas pelo desafio.
   */
  public static from(props: MoneyProps): Money {
    if (
      !props ||
      typeof props.amount !== "string" ||
      typeof props.currency !== "string"
    ) {
      throw new InvalidMoneyValueError("amount and currency must be strings");
    }

    const trimmedCurrency = props.currency.trim().toUpperCase();
    if (!/^[A-Z]{3}$/.test(trimmedCurrency)) {
      throw new InvalidMoneyValueError(
        `Currency must be a valid 3-letter ISO code, received "${props.currency}"`,
      );
    }

    const trimmedAmount = props.amount.trim();

    if (trimmedAmount.length === 0) {
      throw new InvalidMoneyValueError("Amount cannot be empty");
    }

    if (/[eE]/.test(trimmedAmount)) {
      throw new InvalidMoneyValueError("Scientific notation is not allowed");
    }

    const validDecimalRegex = /^\d+(\.\d{1,2})?$/;
    if (!validDecimalRegex.test(trimmedAmount)) {
      throw new InvalidMoneyValueError(
        `Amount must be a non-negative decimal string with at most 2 decimal places, received "${props.amount}"`,
      );
    }

    let parsed: Decimal;
    try {
      parsed = new Decimal(trimmedAmount);
    } catch {
      throw new InvalidMoneyValueError(
        `Cannot parse "${props.amount}" as decimal`,
      );
    }

    if (!parsed.isFinite()) {
      throw new InvalidMoneyValueError(
        "Amount must be finite (not NaN or Infinity)",
      );
    }

    const normalized = new Decimal(parsed.toFixed(2));

    return new Money(normalized, trimmedCurrency);
  }

  /**
   * Factory para criar valor zero em uma determinada moeda.
   */
  public static zero(currency: string): Money {
    const trimmedCurrency = currency.trim().toUpperCase();
    if (!/^[A-Z]{3}$/.test(trimmedCurrency)) {
      throw new InvalidMoneyValueError(
        `Currency must be a valid 3-letter ISO code, received "${currency}"`,
      );
    }
    return new Money(new Decimal("0.00"), trimmedCurrency);
  }

  /**
   * Factory interna para reconstruir estado já existente no banco de dados.
   * Permite valores negativos se necessário internamente (ex: cálculos transitórios).
   */
  public static rehydrate(amount: string, currency: string): Money {
    return new Money(new Decimal(amount), currency.toUpperCase());
  }

  public add(other: Money): Money {
    this.assertSameCurrency(other);
    const result = this.value.plus(other.value);
    return new Money(new Decimal(result.toFixed(2)), this.currency);
  }

  public subtract(other: Money): Money {
    this.assertSameCurrency(other);
    const result = this.value.minus(other.value);
    return new Money(new Decimal(result.toFixed(2)), this.currency);
  }

  public negate(): Money {
    const result = this.value.negated();
    return new Money(new Decimal(result.toFixed(2)), this.currency);
  }

  public isZero(): boolean {
    return this.value.isZero();
  }

  public isPositive(): boolean {
    return this.value.isPositive() && !this.value.isZero();
  }

  public isNegative(): boolean {
    return this.value.isNegative();
  }

  public isLessThan(other: Money): boolean {
    this.assertSameCurrency(other);
    return this.value.lessThan(other.value);
  }

  public isGreaterThan(other: Money): boolean {
    this.assertSameCurrency(other);
    return this.value.greaterThan(other.value);
  }

  public equals(other: Money): boolean {
    if (this.currency !== other.currency) {
      return false;
    }
    return this.value.equals(other.value);
  }

  public toJSON(): MoneyProps {
    return {
      amount: this.toString(),
      currency: this.currency,
    };
  }

  public toString(): string {
    return this.value.toFixed(2);
  }

  private assertSameCurrency(other: Money): void {
    if (this.currency !== other.currency) {
      throw new CurrencyMismatchError(this.currency, other.currency);
    }
  }
}
