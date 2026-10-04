import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { MikroORM } from "@mikro-orm/postgresql";
import config from "../../src/infrastructure/database/mikro-orm.config";
import { PostgresWalletRepository } from "../../src/infrastructure/database/repositories/PostgresWalletRepository";
import { Wallet } from "../../src/domain/models/Wallet";
import { Money } from "../../src/domain/models/Money";
import { v4 as uuidv4 } from "uuid";

describe("Integration: PostgresWalletRepository", () => {
  let orm: MikroORM;

  beforeAll(async () => {
    orm = await MikroORM.init(config);
  });

  afterAll(async () => {
    if (orm) {
      await orm.close(true);
    }
  });

  it("deve persistir uma nova carteira e recuperá-la do banco sem lock", async () => {
    const repository = new PostgresWalletRepository(orm.em.fork());
    const walletId = uuidv4();
    const playerId = uuidv4();
    const wallet = Wallet.open({
      id: walletId,
      playerId,
      initialBalance: Money.from({ amount: "150.00", currency: "BRL" }),
    });

    // Salva no PostgreSQL
    await repository.saveNewWallet(wallet);

    // Busca simples de volta
    const retrieved = await repository.findById(walletId, false);

    expect(retrieved).not.toBeNull();
    expect(retrieved!.id).toBe(walletId);
    expect(retrieved!.playerId).toBe(playerId);
    expect(retrieved!.balance.toString()).toBe("150.00");
    expect(retrieved!.version).toBe(1);
  });

  it("deve recuperar carteira com lock pessimista dentro de uma transação ativa", async () => {
    const forkEm = orm.em.fork();
    const repository = new PostgresWalletRepository(forkEm);
    const walletId = uuidv4();
    const playerId = uuidv4();
    const wallet = Wallet.open({
      id: walletId,
      playerId,
      initialBalance: Money.from({ amount: "300.00", currency: "BRL" }),
    });

    await repository.saveNewWallet(wallet);

    // O LockMode.PESSIMISTIC_WRITE (SELECT FOR UPDATE) exige transação aberta
    await forkEm.transactional(async (em) => {
      const transactionalRepo = new PostgresWalletRepository(em);
      const lockedWallet = await transactionalRepo.findById(walletId, true);

      expect(lockedWallet).not.toBeNull();
      expect(lockedWallet!.id).toBe(walletId);
      expect(lockedWallet!.balance.toString()).toBe("300.00");
    });
  });
});
