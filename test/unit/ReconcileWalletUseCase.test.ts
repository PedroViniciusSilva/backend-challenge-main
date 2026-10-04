import { beforeEach, describe, expect, it } from "bun:test";
import { ReconcileWalletUseCase } from "../../src/application/use-cases/ReconcileWalletUseCase";
import {
  IWalletRepository,
  SaveWagerAtomicParams,
} from "../../src/application/ports/IWalletRepository";
import { Wallet } from "../../src/domain/models/Wallet";
import {
  WalletLedgerEntry,
  LedgerDirection,
} from "../../src/domain/models/WalletLedgerEntry";
import { WagerTransaction } from "../../src/domain/models/WagerTransaction";
import { Money } from "../../src/domain/models/Money";

class ReconcileMockRepository implements IWalletRepository {
  public wallet: Wallet | null = null;
  public entries: WalletLedgerEntry[] = [];

  async transactional(action: (repo: IWalletRepository) => Promise): Promise {
    return action(this);
  }

  async findById(): Promise {
    return this.wallet;
  }
  async findByPlayerIdAndCurrency(): Promise {
    return null;
  }
  async findTransactionByIdempotencyKey(): Promise {
    return null;
  }
  async findTransactionByExternalId(): Promise {
    return null;
  }
  async saveNewWallet(): Promise {}
  async saveWagerAtomic(_params: SaveWagerAtomicParams): Promise {}
  async getLedgerEntries(): Promise {
    return this.entries;
  }
}

describe("Use Case: ReconcileWalletUseCase", () => {
  let repo: ReconcileMockRepository;
  let useCase: ReconcileWalletUseCase;

  beforeEach(() => {
    repo = new ReconcileMockRepository();
    useCase = new ReconcileWalletUseCase(repo);
  });

  it("deve confirmar que a carteira é consistente quando a soma do extrato bate com o saldo", async () => {
    const currency = "BRL";

    repo.wallet = Wallet.rehydrate({
      id: "w-1",
      playerId: "p-1",
      currency,
      balance: Money.from({ amount: "70.00", currency }),
      version: 3,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    repo.entries = [
      WalletLedgerEntry.create({
        id: "led-1",
        walletId: "w-1",
        transactionId: "tx-1",
        direction: LedgerDirection.Credit,
        money: Money.from({ amount: "100.00", currency }),
        balanceBefore: Money.from({ amount: "0.00", currency }),
        balanceAfter: Money.from({ amount: "100.00", currency }),
      }),
      WalletLedgerEntry.create({
        id: "led-2",
        walletId: "w-1",
        transactionId: "tx-2",
        direction: LedgerDirection.Debit,
        money: Money.from({ amount: "30.00", currency }),
        balanceBefore: Money.from({ amount: "100.00", currency }),
        balanceAfter: Money.from({ amount: "70.00", currency }),
      }),
    ];

    const result = await useCase.execute({ walletId: "w-1" });

    expect(result.isConsistent).toBe(true);
    expect(result.currentBalance).toBe("70.00");
    expect(result.calculatedBalance).toBe("70.00");
    expect(result.totalCredits).toBe("100.00");
    expect(result.totalDebits).toBe("30.00");
    expect(result.difference).toBe("0.00");
    expect(result.entriesCount).toBe(2);
  });

  it("deve apontar inconsistência caso o saldo da carteira tenha sido adulterado", async () => {
    const currency = "BRL";

    repo.wallet = Wallet.rehydrate({
      id: "w-corrupt",
      playerId: "p-1",
      currency,
      balance: Money.from({ amount: "99.00", currency }),
      version: 2,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    repo.entries = [
      WalletLedgerEntry.create({
        id: "led-1",
        walletId: "w-corrupt",
        transactionId: "tx-1",
        direction: LedgerDirection.Credit,
        money: Money.from({ amount: "50.00", currency }),
        balanceBefore: Money.from({ amount: "0.00", currency }),
        balanceAfter: Money.from({ amount: "50.00", currency }),
      }),
    ];

    const result = await useCase.execute({ walletId: "w-corrupt" });

    expect(result.isConsistent).toBe(false);
    expect(result.currentBalance).toBe("99.00");
    expect(result.calculatedBalance).toBe("50.00");
    expect(result.difference).toBe("49.00");
  });
});
