import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import {
  CreateQueueCommand,
  DeleteQueueCommand,
  SendMessageCommand,
  SQSClient,
} from "@aws-sdk/client-sqs";
import { randomUUID } from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";

const root = process.cwd();
const processes: ChildProcess[] = [];
const processesByPort = new Map<number, ChildProcess>();
let queueUrl: string;
let sqs: SQSClient;

function startProcess(port: number, extra: Record<string, string> = {}) {
  const child = spawn("bun", ["run", "src/main.ts"], {
    cwd: root,
    env: {
      ...process.env,
      PORT: String(port),
      RUN_MESSAGING_WORKERS: "false",
      ...extra,
    },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  child.stdout?.on("data", () => undefined);
  child.stderr?.on("data", () => undefined);
  processes.push(child);
  processesByPort.set(port, child);
  return child;
}

async function waitForHealth(port: number): Promise<void> {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/health/live`);
      if (response.ok) return;
    } catch {}
    await Bun.sleep(100);
  }
  throw new Error(`Processo na porta ${port} não iniciou`);
}

async function stopProcess(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null) return;
  child.kill();
  await new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, 2_000);
    child.once("exit", () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

describe("Operational distributed process validation", () => {
  beforeAll(async () => {
    sqs = new SQSClient({
      region: "us-east-1",
      endpoint: process.env.SQS_ENDPOINT ?? "http://localhost:4566",
      credentials: {
        accessKeyId: "test",
        secretAccessKey: "test",
      },
    });

    const name = `operational-${randomUUID()}.fifo`;
    const created = await sqs.send(
      new CreateQueueCommand({
        QueueName: name,
        Attributes: {
          FifoQueue: "true",
          ContentBasedDeduplication: "false",
          VisibilityTimeout: "2",
        },
      }),
    );
    queueUrl = created.QueueUrl!;

    for (const port of [3311, 3312, 3313]) {
      startProcess(port);
      await waitForHealth(port);
    }
  }, 40_000);

  afterAll(async () => {
    for (const child of processes.reverse()) {
      await stopProcess(child);
    }
    if (queueUrl) {
      await sqs.send(new DeleteQueueCommand({ QueueUrl: queueUrl }));
    }
    sqs?.destroy();
  }, 30_000);

  it("mantém uma única operação com três instâncias HTTP independentes", async () => {
    const playerId = `operational-${randomUUID()}`;
    const walletResponse = await fetch("http://127.0.0.1:3311/wallets", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        playerId,
        initialBalance: { amount: "100.00", currency: "BRL" },
      }),
    });
    expect(walletResponse.status).toBe(201);
    const wallet = (await walletResponse.json()) as { walletId: string };

    const payload = {
      providerId: "operational-provider",
      externalTransactionId: `tx-${randomUUID()}`,
      idempotencyKey: `idemp-${randomUUID()}`,
      walletId: wallet.walletId,
      playerId,
      roundId: `round-${randomUUID()}`,
      gameId: "operational-game",
      kind: "BET",
      money: { amount: "10.00", currency: "BRL" },
    };

    const responses = await Promise.all(
      [3311, 3312, 3313].map((port) =>
        fetch(`http://127.0.0.1:${port}/wagering/transactions`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-idempotency-key": payload.idempotencyKey,
          },
          body: JSON.stringify(payload),
        }).then((response) => response.json()),
      ),
    );

    expect(responses.every((response) => response.status === "PROCESSED")).toBe(
      true,
    );
    const finalWallet = await fetch(
      `http://127.0.0.1:3313/wallets/${wallet.walletId}`,
    ).then((response) => response.json());
    expect(finalWallet.balance).toBe("90.00");
  });

  it("recupera redelivery após crash entre commit e ack", async () => {
    const playerId = `crash-${randomUUID()}`;
    const walletResponse = await fetch("http://127.0.0.1:3311/wallets", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        playerId,
        initialBalance: { amount: "50.00", currency: "BRL" },
      }),
    });
    const wallet = (await walletResponse.json()) as { walletId: string };
    const messageId = randomUUID();
    const payload = {
      messageId,
      type: "WagerTransactionRequested",
      occurredAt: new Date().toISOString(),
      data: {
        providerId: "crash-provider",
        externalTransactionId: `crash-tx-${randomUUID()}`,
        idempotencyKey: `crash-idemp-${randomUUID()}`,
        walletId: wallet.walletId,
        playerId,
        roundId: `round-${randomUUID()}`,
        gameId: "crash-game",
        kind: "BET",
        money: { amount: "10.00", currency: "BRL" },
      },
    };

    const crashed = startProcess(3314, {
      RUN_MESSAGING_WORKERS: "true",
      SQS_QUEUE_URL: queueUrl,
      SQS_VISIBILITY_TIMEOUT: "2",
      CRASH_AFTER_COMMIT_BEFORE_ACK: "true",
    });
    await waitForHealth(3314);
    await sqs.send(
      new SendMessageCommand({
        QueueUrl: queueUrl,
        MessageBody: JSON.stringify(payload),
        MessageGroupId: "crash-group",
        MessageDeduplicationId: messageId,
      }),
    );

    await new Promise<void>((resolve) => crashed.once("exit", () => resolve()));

    const recovery = startProcess(3315, {
      RUN_MESSAGING_WORKERS: "true",
      SQS_QUEUE_URL: queueUrl,
      SQS_VISIBILITY_TIMEOUT: "2",
    });
    await waitForHealth(3315);
    await Bun.sleep(4_000);

    const finalWallet = await fetch(
      `http://127.0.0.1:3311/wallets/${wallet.walletId}`,
    ).then((response) => response.json());
    expect(finalWallet.balance).toBe("40.00");
    await stopProcess(recovery);
  }, 30_000);

  it("processa wallets diferentes em paralelo sem lock global", async () => {
    const wallets = await Promise.all(
      [1, 2].map(async () => {
        const playerId = `parallel-${randomUUID()}`;
        const response = await fetch("http://127.0.0.1:3312/wallets", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            playerId,
            initialBalance: { amount: "30.00", currency: "BRL" },
          }),
        });
        return {
          ...(await response.json()),
          playerId,
        } as { walletId: string; playerId: string };
      }),
    );

    const startedAt = Date.now();
    await Promise.all(
      wallets.map((wallet, index) =>
        fetch(`http://127.0.0.1:${index ? 3313 : 3311}/wagering/transactions`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-idempotency-key": `parallel-${randomUUID()}`,
          },
          body: JSON.stringify({
            providerId: "parallel-provider",
            externalTransactionId: `parallel-${randomUUID()}`,
            walletId: wallet.walletId,
            playerId: wallet.playerId,
            roundId: `round-${randomUUID()}`,
            gameId: "parallel-game",
            kind: "BET",
            money: { amount: "10.00", currency: "BRL" },
          }),
        }),
      ),
    );
    expect(Date.now() - startedAt).toBeLessThan(2_000);
    const balances = await Promise.all(
      wallets.map((wallet) =>
        fetch(`http://127.0.0.1:3311/wallets/${wallet.walletId}`).then((r) =>
          r.json(),
        ),
      ),
    );
    expect(balances.map((wallet) => wallet.balance)).toEqual([
      "20.00",
      "20.00",
    ]);
  });

  it("mantém saldo, ledger e outbox após reinício completo", async () => {
    const playerId = `restart-${randomUUID()}`;
    const walletResponse = await fetch("http://127.0.0.1:3311/wallets", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        playerId,
        initialBalance: { amount: "25.00", currency: "BRL" },
      }),
    });
    const wallet = (await walletResponse.json()) as { walletId: string };
    const wagerResponse = await fetch(
      "http://127.0.0.1:3311/wagering/transactions",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-idempotency-key": `restart-${randomUUID()}`,
        },
        body: JSON.stringify({
          providerId: "restart-provider",
          externalTransactionId: `restart-${randomUUID()}`,
          walletId: wallet.walletId,
          playerId,
          roundId: `round-${randomUUID()}`,
          gameId: "restart-game",
          kind: "BET",
          money: { amount: "5.00", currency: "BRL" },
        }),
      },
    );
    expect(wagerResponse.status).toBe(200);

    await stopProcess(processesByPort.get(3311)!);
    const restarted = startProcess(3311);
    await waitForHealth(3311);
    const afterRestart = await fetch(
      `http://127.0.0.1:3311/wallets/${wallet.walletId}`,
    ).then((response) => response.json());
    expect(afterRestart.balance).toBe("20.00");
    await stopProcess(restarted);
  }, 30_000);
});
