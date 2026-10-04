import { Money } from "./Money";
import {
  CurrencyMismatchError,
  InsufficientFundsError,
  InvalidWalletStateError,
} from "../errors/DomainError";

export interface WalletState {
  id: string;
  playerId: string;
  currency: string;
  balance: Money;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

export class Wallet {
  private constructor(
    public readonly id: string,
    public readonly playerId: string,
    public readonly currency: string,
    private _balance: Money,
    private _version: number,
    public readonly createdAt: Date,
    private _updatedAt: Date,
  ) {}

  public static open(props: {
    id: string;
    playerId: string;
    initialBalance: Money;
  }): Wallet {
    if (!props.id || props.id.trim().length === 0) {
      throw new InvalidWalletStateError("O ID da carteira é obrigatório");
    }
    if (!props.playerId || props.playerId.trim().length === 0) {
      throw new InvalidWalletStateError(
        "O ID do jogador (playerId) é obrigatório",
      );
    }
    if (!props.initialBalance) {
      throw new InvalidWalletStateError(
        "O saldo inicial da carteira precisa ser informado",
      );
    }

    const now = new Date();
    return new Wallet(
      props.id.trim(),
      props.playerId.trim(),
      props.initialBalance.currency,
      props.initialBalance,
      1,
      now,
      now,
    );
  }

  public static rehydrate(state: WalletState): Wallet {
    return new Wallet(
      state.id,
      state.playerId,
      state.currency,
      state.balance,
      state.version,
      state.createdAt,
      state.updatedAt,
    );
  }

  public get balance(): Money {
    return this._balance;
  }

  public get version(): number {
    return this._version;
  }

  public get updatedAt(): Date {
    return this._updatedAt;
  }

  public debit(amount: Money, now: Date = new Date()): void {
    this.assertSameCurrency(amount);

    if (this._balance.isLessThan(amount)) {
      throw new InsufficientFundsError(
        this._balance.toString(),
        amount.toString(),
        this.currency,
      );
    }

    this._balance = this._balance.subtract(amount);
    this._version += 1;
    this._updatedAt = now;
  }

  public credit(amount: Money, now: Date = new Date()): void {
    this.assertSameCurrency(amount);

    this._balance = this._balance.add(amount);
    this._version += 1;
    this._updatedAt = now;
  }

  private assertSameCurrency(money: Money): void {
    if (this.currency !== money.currency) {
      throw new CurrencyMismatchError(this.currency, money.currency);
    }
  }
}
