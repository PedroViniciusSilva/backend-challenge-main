export enum FailureCode {
  InsufficientFunds = "INSUFFICIENT_FUNDS",
  ReferenceNotFound = "REFERENCE_NOT_FOUND",
  ReferenceAlreadyReversed = "REFERENCE_ALREADY_REVERSED",
  InvalidReferenceKind = "INVALID_REFERENCE_KIND",
  ReferenceMismatch = "REFERENCE_MISMATCH",
  IdempotencyPayloadConflict = "IDEMPOTENCY_PAYLOAD_CONFLICT",
  InvalidAmount = "INVALID_AMOUNT",
  CurrencyMismatch = "CURRENCY_MISMATCH",
  TerminalStateViolation = "TERMINAL_STATE_VIOLATION",
  NegativeBalanceReversal = "NEGATIVE_BALANCE_REVERSAL",
  InfrastructureFailure = "INFRASTRUCTURE_FAILURE",
  TerminalStateConflict = "TERMINAL_STATE_VIOLATION",
  InvalidAmountFormat = "INVALID_AMOUNT",
}

export abstract class DomainError extends Error {
  public abstract readonly code: string;

  constructor(message: string) {
    super(message);
    this.name = this.constructor.name;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class InvalidTransactionStateError extends DomainError {
  public readonly code = FailureCode.TerminalStateViolation;

  constructor(currentStatus: string, attemptedTransition: string) {
    super(
      `Transação já está no estado terminal "${currentStatus}" e não aceita a transição para "${attemptedTransition}"`,
    );
  }
}

export class CurrencyMismatchError extends DomainError {
  public readonly code = FailureCode.CurrencyMismatch;

  constructor(baseCurrency: string, targetCurrency: string) {
    super(
      `Não é permitido operar entre moedas diferentes: ${baseCurrency} e ${targetCurrency}`,
    );
  }
}

export class InvalidMoneyValueError extends DomainError {
  public readonly code = FailureCode.InvalidAmount;

  constructor(reason: string) {
    super(`Valor monetário inválido: ${reason}`);
  }
}

export class InsufficientFundsError extends DomainError {
  public readonly code = FailureCode.InsufficientFunds;

  constructor(
    currentBalance: string,
    attemptedDebit: string,
    currency: string,
  ) {
    super(
      `Saldo insuficiente: saldo atual é ${currentBalance}${currency}, mas tentou debitar ${attemptedDebit}${currency}`,
    );
  }
}

export class InvalidWalletStateError extends DomainError {
  public readonly code = "INVALID_WALLET_STATE";

  constructor(reason: string) {
    super(`Estado da carteira inválido: ${reason}`);
  }
}

export class UnbalancedLedgerEntryError extends DomainError {
  public readonly code = "UNBALANCED_LEDGER_ENTRY";

  constructor(reason: string) {
    super(`Lançamento do ledger não balanceado: ${reason}`);
  }
}
