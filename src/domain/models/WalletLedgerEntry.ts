import { Money } from "./Money";
import { UnbalancedLedgerEntryError } from "../errors/DomainError";

export enum LedgerDirection {
  Debit = "DEBIT",
  Credit = "CREDIT",
}

export interface CreateLedgerEntryProps {
  id: string;
  walletId: string;
  transactionId: string;
  direction: LedgerDirection;
  money: Money;
  balanceBefore: Money;
  balanceAfter: Money;
  createdAt?: Date;
}

export class WalletLedgerEntry {
  private constructor(
    public readonly id: string,
    public readonly walletId: string,
    public readonly transactionId: string,
    public readonly direction: LedgerDirection,
    public readonly money: Money,
    public readonly balanceBefore: Money,
    public readonly balanceAfter: Money,
    public readonly createdAt: Date,
  ) {}

  public static create(props: CreateLedgerEntryProps): WalletLedgerEntry {
    if (!props.id || props.id.trim().length === 0) {
      throw new UnbalancedLedgerEntryError("O ID do lançamento é obrigatório");
    }
    if (!props.walletId || props.walletId.trim().length === 0) {
      throw new UnbalancedLedgerEntryError(
        "O ID da carteira (walletId) é obrigatório",
      );
    }
    if (!props.transactionId || props.transactionId.trim().length === 0) {
      throw new UnbalancedLedgerEntryError(
        "O ID da transação vinculada é obrigatório",
      );
    }

    const entry = new WalletLedgerEntry(
      props.id.trim(),
      props.walletId.trim(),
      props.transactionId.trim(),
      props.direction,
      props.money,
      props.balanceBefore,
      props.balanceAfter,
      props.createdAt ?? new Date(),
    );

    if (!entry.isBalanced()) {
      throw new UnbalancedLedgerEntryError(
        `Matemática inconsistente: SaldoAntes(${props.balanceBefore.toString()}) ` +
          `${props.direction === LedgerDirection.Credit ? "+" : "-"} Valor(${props.money.toString()}) ` +
          `não resulta em SaldoDepois(${props.balanceAfter.toString()})`,
      );
    }

    return entry;
  }

  public static rehydrate(state: {
    id: string;
    walletId: string;
    transactionId: string;
    direction: LedgerDirection;
    money: Money;
    balanceBefore: Money;
    balanceAfter: Money;
    createdAt: Date;
  }): WalletLedgerEntry {
    return new WalletLedgerEntry(
      state.id,
      state.walletId,
      state.transactionId,
      state.direction,
      state.money,
      state.balanceBefore,
      state.balanceAfter,
      state.createdAt,
    );
  }

  public isBalanced(): boolean {
    if (this.direction === LedgerDirection.Credit) {
      const expected = this.balanceBefore.add(this.money);
      return expected.equals(this.balanceAfter);
    }

    if (this.direction === LedgerDirection.Debit) {
      const expected = this.balanceBefore.subtract(this.money);
      return expected.equals(this.balanceAfter);
    }

    return false;
  }
}
