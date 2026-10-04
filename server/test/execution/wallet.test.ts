import assert from "node:assert/strict";
import test from "node:test";
import { createTestRepository } from "../support/database.js";
import { ExecutionService } from "../../src/features/execution/execution.service.js";
import type { IntentService } from "../../src/features/intent/intent.service.js";
import type { HederaProvider } from "../../src/shared/integration/hedera/hedera.client.js";
import type { TestnetProvider } from "../../src/shared/integration/testnet.provider.js";
import type { Execution } from "@9oob/schema";
import { createNoobApp } from "../../src/app.js";

test("interprets before connecting and cannot prepare or approve an unbound action", async () => {
  const repository = await createTestRepository();
  let interpretations = 0;
  const interpreter = {
    interpret: async () => {
      interpretations++;
      return {
        outcome: "ready",
        review: { title: "Unverified model review", facts: [], quote: null },
        message: "",
        action: { kind: "transfer", network: "hedera", asset: "HBAR", amount: "1", recipient: "0.0.2" },
      };
    },
  } as unknown as IntentService;
  const hedera = { account: async (account: string) => ({ account }) } as unknown as HederaProvider;
  const service = new ExecutionService(repository, interpreter, {} as TestnetProvider, hedera);
  const app = createNoobApp({ service, appOrigin: "http://localhost:3000", worker: false });
  const request = (path: string, body: unknown, token?: string) =>
    app.fetch(
      new Request(`http://127.0.0.1:3001/api/noob${path}`, {
        method: "POST",
        headers: {
          origin: "http://localhost:3000",
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify(body),
      }),
    );
  try {
    const created = await request("/executions", { intent: "Send 1 HBAR to 0.0.2" });
    assert.equal(created.status, 201);
    const { execution, accessToken } = (await created.json()) as { execution: Execution; accessToken: string };
    assert.equal(execution.status, "awaiting_wallet");
    assert.equal(execution.accountId, null);
    assert.equal(execution.interpretation.review, null);
    assert.equal(await service.approve(execution.id, accessToken), null);
    assert.equal(await service.prepare(execution.id, accessToken), null);
    assert.equal(await service.connectWallet(execution.id, "foreign-capability", "0.0.1", null), null);
    assert.equal(
      (await request(`/executions/${execution.id}/wallet`, { accountId: "0.0.1", evmAddress: null })).status,
      401,
    );
    assert.equal(
      (await request(`/executions/${execution.id}/wallet`, { accountId: "invalid", evmAddress: null }, accessToken))
        .status,
      400,
    );
    const bound = await request(
      `/executions/${execution.id}/wallet`,
      { accountId: "0.0.1", evmAddress: null },
      accessToken,
    );
    assert.equal(bound.status, 200);
    const reviewed = (await bound.json()).execution as Execution;
    assert.equal(reviewed?.status, "awaiting_approval");
    assert.equal(reviewed?.accountId, "0.0.1");
    assert.equal(reviewed?.interpretation.review?.title, "Send 1 HBAR");
    assert.equal(interpretations, 1);
    assert.equal(await service.connectWallet(execution.id, accessToken, "0.0.9", null), null);
    assert.equal(await service.prepare(execution.id, accessToken), null);
  } finally {
    await repository.close();
  }
});

test("unavailable actions are rejected before requesting a wallet", async () => {
  const repository = await createTestRepository();
  const interpreter = {
    interpret: async () => ({
      outcome: "ready",
      message: "",
      review: null,
      action: { kind: "balance", network: "base", asset: "UNKNOWN" },
    }),
  } as unknown as IntentService;
  const service = new ExecutionService(repository, interpreter, {} as TestnetProvider, {} as HederaProvider);
  try {
    const { execution } = await service.start("Check my UNKNOWN balance on Base");
    assert.equal(execution.status, "unsupported");
    assert.equal(execution.accountId, null);
  } finally {
    await repository.close();
  }
});

test("clarification does not require a wallet and an unbound run can be cancelled", async () => {
  const repository = await createTestRepository();
  const interpreter = {
    interpret: async (intent: string) =>
      intent === "Send something"
        ? { outcome: "clarification", action: null, review: null, message: "Which asset and amount?" }
        : {
            outcome: "ready",
            review: null,
            message: "",
            action: { kind: "balance", network: "hedera", asset: "HBAR" },
          },
  } as unknown as IntentService;
  const service = new ExecutionService(repository, interpreter, {} as TestnetProvider, {} as HederaProvider);
  try {
    const first = await service.start("Send something");
    assert.equal(first.execution.status, "clarification_required");
    assert.equal(first.execution.accountId, null);
    const revised = await service.revise(first.execution.id, first.accessToken, "Check my HBAR balance");
    assert.equal(revised?.status, "awaiting_wallet");
    assert.equal((await service.cancel(first.execution.id, first.accessToken))?.status, "cancelled");
    assert.equal(await service.connectWallet(first.execution.id, first.accessToken, "0.0.1", null), null);
  } finally {
    await repository.close();
  }
});

test("guides incompatible wallets without losing the action and binds the correct signing account", async () => {
  const repository = await createTestRepository();
  const address = `0x${"1".repeat(40)}`;
  const transfer = { kind: "transfer", network: "hedera", asset: "HBAR", amount: "1", recipient: "0.0.2" };
  const swap = {
    kind: "swap",
    sourceNetwork: "hedera",
    destinationNetwork: "base",
    sourceAsset: "HBAR",
    destinationAsset: "USDC",
    amount: "10",
    recipient: address,
  };
  let reviews = 0;
  const interpreter = {
    interpret: async (intent: string) => ({
      outcome: "ready",
      action: intent === "Transfer" ? transfer : swap,
      review: null,
      message: "",
    }),
  } as unknown as IntentService;
  const routes = {
    review: async (_action: unknown, account: string) => {
      reviews++;
      assert.equal(account, address);
      return { title: "Swap 10 HBAR", facts: [], quote: null };
    },
  } as unknown as TestnetProvider;
  const hedera = {
    account: async (account: string) => ({
      account: account === address ? "0.0.1" : account,
      evm_address: account === address ? address : null,
    }),
  } as unknown as HederaProvider;
  const service = new ExecutionService(repository, interpreter, routes, hedera);
  try {
    const native = await service.start("Swap", "0.0.1");
    assert.equal(native.execution.status, "awaiting_wallet");
    assert.equal(native.execution.interpretation.action?.kind, "swap");
    assert.equal(native.execution.interpretation.review, null);
    assert.equal(reviews, 0);
    const wrong = await service.connectWallet(native.execution.id, native.accessToken, "0.0.2", null);
    assert.equal(wrong?.status, "awaiting_wallet");
    assert.equal(wrong?.version, native.execution.version);
    assert.equal(await service.approve(native.execution.id, native.accessToken), null);
    const bound = await service.connectWallet(native.execution.id, native.accessToken, "0.0.1", address);
    assert.equal(bound?.status, "awaiting_approval");
    assert.equal(bound?.accountId, address);
    assert.equal(reviews, 1);
    assert.equal(await service.connectWallet(native.execution.id, native.accessToken, "0.0.9", null), null);
    const revised = await service.revise(native.execution.id, native.accessToken, "Transfer");
    assert.equal(revised?.status, "awaiting_approval");
    assert.equal(revised?.interpretation.action?.kind, "transfer");
    assert.equal(revised?.accountId, address);
    assert.equal(revised?.interpretation.review?.title, "Send 1 HBAR");
    const evm = await service.start("Transfer", address, address);
    assert.equal(evm.execution.status, "awaiting_approval");
    assert.equal(evm.execution.interpretation.action?.kind, "transfer");
    const both = await service.start("Swap", "0.0.1", address);
    assert.equal(both.execution.accountId, address);
    assert.equal(both.execution.status, "awaiting_approval");
  } finally {
    await repository.close();
  }
});
