import { beforeEach, describe, expect, it } from "bun:test";
import { ProcessWagerUseCase } from "../../src/application/use-cases/ProcessWagerUseCase";
import {
  IWalletRepository,
  SaveWagerAtomicParams,
} from "../../src/application/ports/IWalletRepository";
import { Wallet } from "../../src/domain/models/Wallet";
import { WalletLedgerEntry } from "../../src/domain/models/WalletLedgerEntry";
import {
  WagerTransaction,
  WagerTransactionKind,
  WagerTransactionStatus,
} from "../../src/domain/models/WagerTransaction";
import { Money } from "../../src/domain/models/Money";
import { FailureCode } from "../../src/domain/errors/DomainError";

class MockWalletRepository implements IWalletRepository {
  public wallets = new Map();
  public transactions = new Map();
  public ledgers: WalletLedgerEntry[] = [];

  async transactional(action: (repo: IWalletRepository) => Promise): Promise {
    return action(this);
  }

  async findById(id: string): Promise {
    return this.wallets.get(id) ?? null;
  }

  async findByPlayerIdAndCurrency(): Promise {
    return null;
  }

  async findTransactionByIdempotencyKey(key: string): Promise {
    return this.transactions.get(key) ?? null;
  }

  async findTransactionByExternalId(
    providerId: string,
    externalId: string,
  ): Promise {
    for (const tx of this.transactions.values()) {
      if (
        tx.providerId === providerId &&
        tx.externalTransactionId === externalId
      ) {
        return tx;
      }
    }
    return null;
  }

  async saveNewWallet(wallet: Wallet): Promise {
    this.wallets.set(wallet.id, wallet);
  }

  async saveWagerAtomic(params: SaveWagerAtomicParams): Promise {
    this.wallets.set(params.wallet.id, params.wallet);
    this.transactions.set(
      params.transaction.idempotencyKey,
      params.transaction,
    );
    if (params.ledgerEntry) {
      this.ledgers.push(params.ledgerEntry);
    }
  }

  async getLedgerEntries(): Promise {
    return this.ledgers;
  }
}

describe("Use Case: ProcessWagerUseCase", () => {
  let repo: MockWalletRepository;
  let useCase: ProcessWagerUseCase;
  let wallet: Wallet;

  beforeEach(() => {
    repo = new MockWalletRepository();
    useCase = new ProcessWagerUseCase(repo);

    wallet = Wallet.open({
      id: "wallet-10",
      playerId: "player-10",
      initialBalance: Money.from({ amount: "100.00", currency: "BRL" }),
    });
    repo.wallets.set(wallet.id, wallet);
  });

  it("deve processar uma aposta (BET) com sucesso e debitar o saldo", async () => {
    const result = await useCase.execute({
      providerId: "prv-1",
      externalTransactionId: "bet-01",
      idempotencyKey: "prv-1:bet-01",
      walletId: wallet.id,
      playerId: wallet.playerId,
      roundId: "round-1",
      gameId: "game-1",
      kind: WagerTransactionKind.Bet,
      amount: "40.00",
      currency: "BRL",
    });

    expect(result.status).toBe(WagerTransactionStatus.Processed);
    expect(result.currentBalance).toBe("60.00");
    expect(result.walletVersion).toBe(2);
    expect(repo.ledgers.length).toBe(1);
  });

  it("deve rejeitar uma aposta quando não houver saldo suficiente", async () => {
    const result = await useCase.execute({
      providerId: "prv-1",
      externalTransactionId: "bet-02",
      idempotencyKey: "prv-1:bet-02",
      walletId: wallet.id,
      playerId: wallet.playerId,
      roundId: "round-2",
      gameId: "game-1",
      kind: WagerTransactionKind.Bet,
      amount: "150.00",
      currency: "BRL",
    });

    expect(result.status).toBe(WagerTransactionStatus.Rejected);
    expect(result.failureCode).toBe(FailureCode.InsufficientFunds);
    expect(result.currentBalance).toBe("100.00");
    expect(repo.ledgers.length).toBe(0);
  });

  it("deve retornar replay idempotente quando receber a mesma requisição repetida", async () => {
    const payload = {
      providerId: "prv-1",
      externalTransactionId: "bet-03",
      idempotencyKey: "prv-1:bet-03",
      walletId: wallet.id,
      playerId: wallet.playerId,
      roundId: "round-3",
      gameId: "game-1",
      kind: WagerTransactionKind.Bet,
      amount: "20.00",
      currency: "BRL",
    };

    const first = await useCase.execute(payload);
    expect(first.isIdempotentReplay).toBe(false);

    const second = await useCase.execute(payload);
    expect(second.isIdempotentReplay).toBe(true);
    expect(second.transactionId).toBe(first.transactionId);
    expect(second.currentBalance).toBe("80.00");
  });

  it("deve acusar IDEMPOTENCY_PAYLOAD_CONFLICT se a mesma chave for enviada com valor diferente", async () => {
    await useCase.execute({
      providerId: "prv-1",
      externalTransactionId: "bet-04",
      idempotencyKey: "prv-1:bet-04",
      walletId: wallet.id,
      playerId: wallet.playerId,
      roundId: "round-4",
      gameId: "game-1",
      kind: WagerTransactionKind.Bet,
      amount: "20.00",
      currency: "BRL",
    });

    const conflict = await useCase.execute({
      providerId: "prv-1",
      externalTransactionId: "bet-04",
      idempotencyKey: "prv-1:bet-04",
      walletId: wallet.id,
      playerId: wallet.playerId,
      roundId: "round-4",
      gameId: "game-1",
      kind: WagerTransactionKind.Bet,
      amount: "35.00",
      currency: "BRL",
    });

    expect(conflict.failureCode).toBe(FailureCode.IdempotencyPayloadConflict);
    expect(conflict.status).toBe(WagerTransactionStatus.Rejected);
  });
});
