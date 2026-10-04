import { describe, expect, it } from "bun:test";
import { OpenWalletUseCase } from "../../src/application/use-cases/OpenWalletUseCase";
import {
  IWalletRepository,
  SaveWagerAtomicParams,
} from "../../src/application/ports/IWalletRepository";
import { Wallet } from "../../src/domain/models/Wallet";
import { WalletLedgerEntry } from "../../src/domain/models/WalletLedgerEntry";
import { WagerTransaction } from "../../src/domain/models/WagerTransaction";

class InMemoryWalletRepository implements IWalletRepository {
  private wallets: Map = new Map();

  async transactional(action: (repo: IWalletRepository) => Promise): Promise {
    return action(this);
  }

  async findById(id: string): Promise {
    return this.wallets.get(id) ?? null;
  }

  async findByPlayerIdAndCurrency(playerId: string, currency: string): Promise {
    for (const w of this.wallets.values()) {
      if (w.playerId === playerId && w.currency === currency) {
        return w;
      }
    }
    return null;
  }

  async findTransactionByIdempotencyKey(): Promise {
    return null;
  }

  async findTransactionByExternalId(): Promise {
    return null;
  }

  async saveNewWallet(wallet: Wallet): Promise {
    this.wallets.set(wallet.id, wallet);
  }

  async saveWagerAtomic(_params: SaveWagerAtomicParams): Promise {}

  async getLedgerEntries(): Promise {
    return [];
  }
}

describe("Use Case: OpenWalletUseCase", () => {
  it("deve abrir uma nova carteira com saldo inicial e marcar isNew=true", async () => {
    const repo = new InMemoryWalletRepository();
    const useCase = new OpenWalletUseCase(repo);

    const result = await useCase.execute({
      playerId: "player-123",
      currency: "BRL",
      initialAmount: "50.00",
    });

    expect(result.isNew).toBe(true);
    expect(result.playerId).toBe("player-123");
    expect(result.currency).toBe("BRL");
    expect(result.balance).toBe("50.00");
    expect(result.version).toBe(1);
  });

  it("deve retornar a carteira existente de forma idempotente sem criar uma nova", async () => {
    const repo = new InMemoryWalletRepository();
    const useCase = new OpenWalletUseCase(repo);

    const first = await useCase.execute({
      playerId: "player-123",
      currency: "BRL",
      initialAmount: "50.00",
    });

    const second = await useCase.execute({
      playerId: "player-123",
      currency: "BRL",
      initialAmount: "100.00",
    });

    expect(second.isNew).toBe(false);
    expect(second.walletId).toBe(first.walletId);
    expect(second.balance).toBe("50.00");
  });
});
