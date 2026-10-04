import { createTestRepository } from "../support/database.js";
import { createNoobApp } from "../../src/app.js";
import { ExecutionService } from "../../src/features/execution/execution.service.js";
import { reconcilePending } from "../../src/features/execution/execution.worker.js";
import type { IntentService } from "../../src/features/intent/intent.service.js";
import type { HederaProvider } from "../../src/shared/integration/hedera/hedera.client.js";
import type { TestnetProvider } from "../../src/shared/integration/testnet.provider.js";
import type { Execution } from "@9oob/schema";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

test("standalone API preserves approval, capability isolation, and background settlement", async () => {
  const directory = await mkdtemp(join(tmpdir(), "9oob-http-"));
  const store = await createTestRepository(join(directory, "data"));
  let receiptChecks = 0;
  const interpreter = {
    interpret: async () => ({
      outcome: "ready",
      message: "",
      review: null,
      action: { kind: "transfer", network: "hedera", asset: "HBAR", amount: "1", recipient: "0.0.2" },
    }),
  } as unknown as IntentService;
  const hedera = {
    account: async (account: string) => ({ account, balance: { balance: 200000000 } }),
    transactionStatus: async () => {
      receiptChecks++;
      return "success";
    },
  } as unknown as HederaProvider;
  const service = new ExecutionService(store, interpreter, {} as TestnetProvider, hedera);
  const app = createNoobApp({ service, appOrigin: "http://localhost:3000", worker: false });
  const request = (path: string, method: string, body?: unknown, token?: string, origin = "http://localhost:3000") =>
    app.fetch(
      new Request(`http://127.0.0.1:3001/api/noob${path}`, {
        method,
        headers: { origin, "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      }),
    );
  try {
    const input = { intent: "Send 1 HBAR to 0.0.2", accountId: "0.0.1", evmAddress: null };
    assert.equal((await request("/executions", "POST", input, undefined, "https://foreign.example")).status, 403);
    assert.equal((await request("/executions", "POST", { intent: "" })).status, 400);
    const created = await request("/executions", "POST", input);
    assert.equal(created.status, 201);
    const { execution, accessToken } = (await created.json()) as { execution: Execution; accessToken: string };
    const path = `/executions/${execution.id}`;
    assert.equal(execution.status, "awaiting_approval");
    assert.equal((await request(path, "GET")).status, 401);
    assert.equal((await request(path, "GET", undefined, "x".repeat(43))).status, 404);
    assert.equal((await request(`${path}/prepare`, "POST", undefined, accessToken)).status, 409);
    assert.equal((await request(`${path}/approve`, "POST", undefined, accessToken)).status, 200);
    const prepared = (await (await request(`${path}/prepare`, "POST", undefined, accessToken)).json()) as {
      execution: Execution;
    };
    assert.equal((await request(`${path}/submitted`, "POST", { txHash: "invalid" }, accessToken)).status, 400);
    const submission = await request(
      `${path}/submitted`,
      "POST",
      {
        txHash: "0.0.1@1800000000.000000001",
        preparationVersion: prepared.execution.version,
      },
      accessToken,
    );
    assert.equal(submission.status, 200);
    assert.equal((await store.pending()).length, 1);
    await reconcilePending(store, service);
    assert.equal((await store.pending()).length, 0);
    assert.equal(receiptChecks, 1);
    const completed = (await (await request(path, "GET", undefined, accessToken)).json()) as { execution: Execution };
    assert.equal(completed.execution.status, "completed");
    assert.equal((await request(`${path}/prepare`, "POST", undefined, accessToken)).status, 409);
    assert.equal(receiptChecks, 1);
    for (let i = 0; i < 11; i++) assert.equal((await request("/executions", "POST", input)).status, 201);
    const limited = await request("/executions", "POST", input);
    assert.equal(limited.status, 429);
    assert.equal(limited.headers.get("Retry-After"), "60");
  } finally {
    await app.close();
    await store.close();
    await rm(directory, { recursive: true, force: true });
  }
});
