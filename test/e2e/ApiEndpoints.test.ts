import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { INestApplication, ValidationPipe } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "../../src/app.module";
import { DomainExceptionFilter } from "../../src/interfaces/http/filters/DomainExceptionFilter";
import { v4 as uuidv4 } from "uuid";

describe("E2E: API Endpoints", () => {
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

  it("GET /health/liveness deve responder com status UP", async () => {
    const response = await fetch(`${baseUrl}/health/liveness`);
    expect(response.status).toBe(200);

    const body = (await response.json()) as { status: string };
    expect(body.status).toBe("UP");
  });

  it("POST /wallets deve criar uma carteira com saldo inicial", async () => {
    const playerId = uuidv4();
    const response = await fetch(`${baseUrl}/wallets`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        playerId,
        currency: "BRL",
        initialAmount: "200.00",
      }),
    });

    const responseBody = await response.json();
    if (response.status !== 201) {
      console.error("Falha em POST /wallets:", responseBody);
    }

    expect(response.status).toBe(201);
    const data = responseBody as {
      walletId: string;
      playerId: string;
      currency: string;
      balance: string;
      isNew: boolean;
    };

    expect(data.isNew).toBe(true);
    expect(data.balance).toBe("200.00");
    expect(data.currency).toBe("BRL");
    expect(data.walletId).toBeDefined();
  });

  it("POST /wagers deve debitar saldo em aposta BET e registrar idempotência", async () => {
    const playerId = uuidv4();
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

    const wagerPayload = {
      providerId: "provider-test",
      externalTransactionId: `ext-${uuidv4()}`,
      idempotencyKey: `idemp-${uuidv4()}`,
      walletId: wallet.walletId,
      playerId,
      roundId: `round-${uuidv4()}`,
      gameId: "crash-game",
      kind: "BET",
      amount: "35.00",
      currency: "BRL",
    };

    const wagerRes = await fetch(`${baseUrl}/wagers`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(wagerPayload),
    });

    const wagerData = (await wagerRes.json()) as {
      status: string;
      currentBalance: string;
      isIdempotentReplay: boolean;
    };

    expect(wagerRes.status).toBe(200);
    expect(wagerData.status).toBe("PROCESSED");
    expect(wagerData.currentBalance).toBe("65.00");
    expect(wagerData.isIdempotentReplay).toBe(false);

    const replayRes = await fetch(`${baseUrl}/wagers`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(wagerPayload),
    });

    expect(replayRes.status).toBe(200);
    const replayData = (await replayRes.json()) as {
      currentBalance: string;
      isIdempotentReplay: boolean;
    };
    expect(replayData.currentBalance).toBe("65.00");
    expect(replayData.isIdempotentReplay).toBe(true);
  });
});
