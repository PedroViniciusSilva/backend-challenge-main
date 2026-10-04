import { Money } from "./Money";
import { LedgerDirection } from "./WalletLedgerEntry";
import {
  FailureCode,
  InvalidTransactionStateError,
  InvalidMoneyValueError,
} from "../errors/DomainError";

export enum WagerTransactionKind {
  Opening = "OPENING",
  Bet = "BET",
  Win = "WIN",
  Loss = "LOSS",
  Refund = "REFUND",
  Rollback = "ROLLBACK",
}

export enum WagerTransactionStatus {
  Pending = "PENDING", // Criada, pronta para ser avaliada
  PendingReference = "PENDING_REFERENCE",
  Processed = "PROCESSED",
  Rejected = "REJECTED",
  Failed = "FAILED",
}

export interface CreateWagerTransactionProps {
  id: string;
  providerId: string;
  externalTransactionId: string;
  idempotencyKey: string;
  payloadHash: string;
  walletId: string;
  playerId: string;
  roundId: string;
  gameId: string;
  kind: WagerTransactionKind;
  money: Money;
  referenceExternalTransactionId?: string;
  createdAt?: Date;
}

export class WagerTransaction {
  private constructor(
    public readonly id: string,
    public readonly providerId: string,
    public readonly externalTransactionId: string,
    public readonly idempotencyKey: string,
    public readonly payloadHash: string,
    public readonly walletId: string,
    public readonly playerId: string,
    public readonly roundId: string,
    public readonly gameId: string,
    public readonly kind: WagerTransactionKind,
    public readonly money: Money,
    public readonly referenceExternalTransactionId: string | undefined,
    public readonly createdAt: Date,
    private _status: WagerTransactionStatus,
    private _referenceTransactionId?: string,
    private _failureCode?: FailureCode,
    private _processedAt?: Date,
  ) {}

  public static create(props: CreateWagerTransactionProps): WagerTransaction {
    if (!props.id || props.id.trim().length === 0) {
      throw new InvalidMoneyValueError("O ID da transação é obrigatório");
    }
    if (!props.idempotencyKey || props.idempotencyKey.trim().length === 0) {
      throw new InvalidMoneyValueError("A Idempotency-Key é obrigatória");
    }
    if (!props.payloadHash || props.payloadHash.trim().length === 0) {
      throw new InvalidMoneyValueError("O hash do payload é obrigatório");
    }

    const needsRef =
      props.kind === WagerTransactionKind.Refund ||
      props.kind === WagerTransactionKind.Rollback;
    if (
      needsRef &&
      (!props.referenceExternalTransactionId ||
        props.referenceExternalTransactionId.trim().length === 0)
    ) {
      throw new InvalidMoneyValueError(
        `Transações do tipo ${props.kind} exigem uma transação de referência`,
      );
    }

    return new WagerTransaction(
      props.id.trim(),
      props.providerId.trim(),
      props.externalTransactionId.trim(),
      props.idempotencyKey.trim(),
      props.payloadHash.trim(),
      props.walletId.trim(),
      props.playerId.trim(),
      props.roundId.trim(),
      props.gameId.trim(),
      props.kind,
      props.money,
      props.referenceExternalTransactionId?.trim(),
      props.createdAt ?? new Date(),
      WagerTransactionStatus.Pending,
    );
  }

  public static rehydrate(state: {
    id: string;
    providerId: string;
    externalTransactionId: string;
    idempotencyKey: string;
    payloadHash: string;
    walletId: string;
    playerId: string;
    roundId: string;
    gameId: string;
    kind: WagerTransactionKind;
    money: Money;
    referenceExternalTransactionId?: string;
    createdAt: Date;
    status: WagerTransactionStatus;
    referenceTransactionId?: string;
    failureCode?: FailureCode;
    processedAt?: Date;
  }): WagerTransaction {
    return new WagerTransaction(
      state.id,
      state.providerId,
      state.externalTransactionId,
      state.idempotencyKey,
      state.payloadHash,
      state.walletId,
      state.playerId,
      state.roundId,
      state.gameId,
      state.kind,
      state.money,
      state.referenceExternalTransactionId,
      state.createdAt,
      state.status,
      state.referenceTransactionId,
      state.failureCode,
      state.processedAt,
    );
  }

  public get status(): WagerTransactionStatus {
    return this._status;
  }

  public get referenceTransactionId(): string | undefined {
    return this._referenceTransactionId;
  }

  public get failureCode(): FailureCode | undefined {
    return this._failureCode;
  }

  public get processedAt(): Date | undefined {
    return this._processedAt;
  }

  public markProcessed(
    referenceTransactionId: string | undefined,
    at: Date = new Date(),
  ): void {
    this.assertNotTerminal("PROCESSED");
    this._status = WagerTransactionStatus.Processed;
    this._referenceTransactionId = referenceTransactionId;
    this._processedAt = at;
  }

  public markPendingReference(): void {
    this.assertNotTerminal("PENDING_REFERENCE");
    this._status = WagerTransactionStatus.PendingReference;
  }

  public reject(code: FailureCode, at: Date = new Date()): void {
    this.assertNotTerminal("REJECTED");
    this._status = WagerTransactionStatus.Rejected;
    this._failureCode = code;
    this._processedAt = at;
  }

  public fail(code: FailureCode, at: Date = new Date()): void {
    this.assertNotTerminal("FAILED");
    this._status = WagerTransactionStatus.Failed;
    this._failureCode = code;
    this._processedAt = at;
  }

  public isTerminal(): boolean {
    return (
      this._status === WagerTransactionStatus.Processed ||
      this._status === WagerTransactionStatus.Rejected ||
      this._status === WagerTransactionStatus.Failed
    );
  }

  public affectsBalance(): boolean {
    return this.kind !== WagerTransactionKind.Loss;
  }

  public requiresReference(): boolean {
    return (
      this.kind === WagerTransactionKind.Refund ||
      this.kind === WagerTransactionKind.Rollback
    );
  }

  public matchesPayload(payloadHash: string): boolean {
    return this.payloadHash === payloadHash;
  }

  public ledgerDirectionFor(reference?: WagerTransaction): LedgerDirection {
    switch (this.kind) {
      case WagerTransactionKind.Opening:
      case WagerTransactionKind.Win:
      case WagerTransactionKind.Refund:
        return LedgerDirection.Credit;

      case WagerTransactionKind.Bet:
        return LedgerDirection.Debit;

      case WagerTransactionKind.Rollback:
        if (!reference) {
          throw new InvalidMoneyValueError(
            "Para ROLLBACK é obrigatório ter a transação de referência",
          );
        }
        return reference.ledgerDirectionFor() === LedgerDirection.Debit
          ? LedgerDirection.Credit
          : LedgerDirection.Debit;

      case WagerTransactionKind.Loss:
      default:
        throw new InvalidMoneyValueError(
          `Transação do tipo ${this.kind} não gera movimentação no ledger`,
        );
    }
  }

  private assertNotTerminal(attemptedTransition: string): void {
    if (this.isTerminal()) {
      throw new InvalidTransactionStateError(this._status, attemptedTransition);
    }
  }
}
