import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { INestApplication, ValidationPipe } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "../../src/app.module";
import { DomainExceptionFilter } from "../../src/interfaces/http/filters/DomainExceptionFilter";
import { v4 as uuidv4 } from "uuid";

describe("Concurrency & Stress: Distributed Wagering Processor", () => {
  let app: INestApplication;
  let baseUrl: string;

  beforeAll(async () => {
    app = await NestFactory.create(AppModule, { logger: false });
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    app.useGlobalFilters(new DomainExceptionFilter());

    await app.listen(0);
    const server = app.getHttpServer();
    const address = server.address();
    const port = typeof address === "string" ? address : address.port;
    baseUrl = `http://localhost:${port}`;
  });

  afterAll(async () => {
    if (app) {
      await app.close();
    }
  });

  it("deve processar 50 requisições concorrentes de débito sem gerar saldo negativo (Race Condition Test)", async () => {
    const playerId = `stress-player-${uuidv4()}`;

    // 1. Abre carteira com R$ 100,00
    const openRes = await fetch(`${baseUrl}/wallets`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        playerId,
        currency: "BRL",
        initialAmount: "100.00",
      }),
    });

    expect(openRes.status).toBe(201);
    const wallet = (await openRes.json()) as { walletId: string };

    // 2. Prepara 50 requisições de débito de R$ 10,00 cada
    const totalRequests = 50;
    const betAmount = "10.00";

    const requests = Array.from({ length: totalRequests }).map((_, index) => {
      const payload = {
        providerId: "stress-provider",
        externalTransactionId: `tx-stress-${index}-${uuidv4()}`,
        idempotencyKey: `idemp-stress-${index}-${uuidv4()}`,
        walletId: wallet.walletId,
        playerId,
        roundId: `round-${uuidv4()}`,
        gameId: "roulette",
        kind: "BET",
        amount: betAmount,
        currency: "BRL",
      };

      return fetch(`${baseUrl}/wagers`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      }).then(async (res) => ({
        status: res.status,
        body: (await res.json()) as {
          status: string;
          currentBalance: string;
          failureCode?: string;
        },
      }));
    });

    // 3. Dispara todas as 50 requisições simultaneamente em paralelo
    const results = await Promise.all(requests);

    // 4. Analisa os resultados
    const processedTxs = results.filter((r) => r.body.status === "PROCESSED");
    const rejectedTxs = results.filter(
      (r) =>
        r.body.status === "REJECTED" &&
        r.body.failureCode === "INSUFFICIENT_FUNDS",
    );

    // Exatamente 10 apostas de R$ 10,00 cabem em R$ 100,00
    expect(processedTxs.length).toBe(10);
    // As outras 40 devem ser rejeitadas por falta de saldo
    expect(rejectedTxs.length).toBe(40);

    // 5. Confere saldo final na carteira
    const getRes = await fetch(`${baseUrl}/wallets/${wallet.walletId}`);
    expect(getRes.status).toBe(200);
    const finalWallet = (await getRes.json()) as {
      balance: string;
      version: number;
    };

    expect(finalWallet.balance).toBe("0.00");
    // Versão da carteira: 1 (abertura) + 10 (débitos aprovados) = 11
    expect(finalWallet.version).toBe(11);

    // 6. Executa Reconciliação Contábil formal do extrato
    const reconcileRes = await fetch(
      `${baseUrl}/wallets/${wallet.walletId}/reconcile`,
    );
    expect(reconcileRes.status).toBe(200);
    const reconcileData = (await reconcileRes.json()) as {
      isConsistent: boolean;
      currentBalance: string;
      calculatedBalance: string;
      difference: string;
      entriesCount: number;
    };

    expect(reconcileData.isConsistent).toBe(true);
    expect(reconcileData.difference).toBe("0.00");
    expect(reconcileData.currentBalance).toBe("0.00");
    expect(reconcileData.calculatedBalance).toBe("0.00");
    // 1 crédito inicial + 10 débitos de aposta = 11 entradas no extrato
    expect(reconcileData.entriesCount).toBe(11);
  });

  it("deve suportar rajadas paralelas com a mesma chave de idempotência retornando o mesmo resultado", async () => {
    const playerId = `idemp-player-${uuidv4()}`;

    const openRes = await fetch(`${baseUrl}/wallets`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        playerId,
        currency: "BRL",
        initialAmount: "50.00",
      }),
    });
    const wallet = (await openRes.json()) as { walletId: string };

    const fixedKey = `same-key-${uuidv4()}`;
    const payload = {
      providerId: "burst-provider",
      externalTransactionId: `burst-${uuidv4()}`,
      idempotencyKey: fixedKey,
      walletId: wallet.walletId,
      playerId,
      roundId: `round-${uuidv4()}`,
      gameId: "blackjack",
      kind: "BET",
      amount: "20.00",
      currency: "BRL",
    };

    // Dispara 10 requisições simultâneas com a exata mesma chave
    const burstRequests = Array.from({ length: 10 }).map(() =>
      fetch(`${baseUrl}/wagers`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      }).then(async (res) => ({
        status: res.status,
        body: (await res.json()) as {
          status: string;
          currentBalance: string;
          isIdempotentReplay: boolean;
        },
      })),
    );

    const burstResults = await Promise.all(burstRequests);

    // Todas as respostas devem ser 200 OK e apontar status PROCESSED
    for (const res of burstResults) {
      expect(res.status).toBe(200);
      expect(res.body.status).toBe("PROCESSED");
      expect(res.body.currentBalance).toBe("30.00");
    }

    // Apenas uma deve ter executado a operação primária (isIdempotentReplay: false)
    const primaryCount = burstResults.filter(
      (r) => !r.body.isIdempotentReplay,
    ).length;
    expect(primaryCount).toBe(1);

    // As outras 9 devem ser identificadas como replay idempotente
    const replayCount = burstResults.filter(
      (r) => r.body.isIdempotentReplay,
    ).length;
    expect(replayCount).toBe(9);
  });
});
