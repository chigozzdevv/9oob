import assert from "node:assert/strict";
import test from "node:test";
import { InterpretationSchema, type ClarificationTurn, type Execution, type IntentAction } from "@9oob/schema";
import { createTestRepository } from "../support/database.js";
import { ExecutionService } from "../../src/features/execution/execution.service.js";
import type { IntentService } from "../../src/features/intent/intent.service.js";
import type { HederaProvider } from "../../src/shared/integration/hedera/hedera.client.js";
import type { TestnetProvider } from "../../src/shared/integration/testnet.provider.js";
import type { BaseProvider } from "../../src/shared/integration/base/base.client.js";
import { createNoobApp } from "../../src/app.js";
import { PlanService } from "../../src/features/plan/index.js";

const swapIntent = "Swap 0.1 HBAR for USDC on Hedera Testnet";
const swap = (recipient = "self") =>
  InterpretationSchema.parse({
    outcome: "ready",
    action: {
      kind: "swap",
      sourceNetwork: "hedera",
      destinationNetwork: "hedera",
      sourceAsset: "HBAR",
      destinationAsset: "USDC",
      amount: "0.1",
      recipient,
    },
    message: "",
    review: null,
  });

test("swap output binds to the connected wallet before review and remains bound when preparing after recovery", async () => {
  const repository = await createTestRepository();
  const address = `0x${"1".repeat(40)}`;
  let reviews = 0;
  const interpreter = { interpret: async () => swap() } as unknown as IntentService;
  const routes = {
    review: async (action: IntentAction, sender: string) => {
      reviews++;
      assert.equal(sender, address);
      assert.equal(action.kind === "swap" && action.recipient, address);
      return {
        title: swapIntent,
        facts: [`To: ${address}`],
        quote: { amountRaw: "10", amountDecimals: 6, amountSymbol: "USDC" },
      };
    },
    prepare: async (action: IntentAction, sender: string) => {
      assert.equal(sender, address);
      assert.equal(action.kind === "swap" && action.recipient, address);
      return {
        phase: "source",
        label: "Confirm swap",
        transaction: { from: sender, to: address, data: "0x", value: "0" },
        context: { sourceChainKey: "hedera", recipient: address },
      };
    },
  } as unknown as TestnetProvider;
  const service = new ExecutionService(repository, interpreter, routes, {} as HederaProvider);
  try {
    const start = await service.start(swapIntent);
    assert.equal(start.execution.status, "awaiting_wallet");
    assert.equal(
      start.execution.interpretation.action?.kind === "swap" && start.execution.interpretation.action.recipient,
      "self",
    );
    assert.equal(reviews, 0);
    assert.equal(await service.prepare(start.execution.id, start.accessToken), null);
    const bound = await service.connectWallet(start.execution.id, start.accessToken, "0.0.1", address);
    assert.equal(bound?.status, "awaiting_approval");
    assert.deepEqual(bound?.interpretation.review?.facts, [`To: ${address}`]);
    const recovered = new ExecutionService(repository, interpreter, routes, {} as HederaProvider);
    assert.equal(
      await recovered.connectWallet(start.execution.id, start.accessToken, `0x${"2".repeat(40)}`, null),
      null,
    );
    await recovered.approve(start.execution.id, start.accessToken);
    const prepared = await recovered.prepare(start.execution.id, start.accessToken);
    assert.equal(prepared?.execution.status, "awaiting_signature");
    assert.equal(prepared?.execution.accountId, address);
    assert.equal(
      prepared?.execution.interpretation.action?.kind === "swap" && prepared.execution.interpretation.action.recipient,
      address,
    );
    assert.equal(reviews, 1);
    assert.equal(prepared?.execution.sourceTxHash, null);
  } finally {
    await repository.close();
  }
});

test("explicit swap recipients are preserved or resolved on Hedera, never replaced with the sender", async () => {
  const sender = `0x${"1".repeat(40)}`;
  const recipient = `0x${"2".repeat(40)}`;
  const recipients: string[] = [];
  const routes = {
    review: async (action: Extract<IntentAction, { kind: "swap" }>) => {
      recipients.push(action.recipient);
      return { title: swapIntent, facts: [`To: ${action.recipient}`], quote: null };
    },
  } as unknown as TestnetProvider;
  const hedera = {
    account: async (id: string) => {
      assert.equal(id, "0.0.2");
      return { account: id, evm_address: recipient };
    },
  } as unknown as HederaProvider;
  const plan = new PlanService(hedera, routes);
  for (const destination of [recipient, "0.0.2"]) {
    const reviewed = await plan.review(swap(destination), sender, sender);
    assert.equal(reviewed.outcome, "ready");
    assert.equal(reviewed.action?.kind === "swap" && reviewed.action.recipient, recipient);
  }
  const base = swap("0.0.2");
  if (base.action?.kind === "swap") base.action.destinationNetwork = "base";
  assert.equal((await plan.review(base, null, null)).outcome, "unsupported");
  assert.deepEqual(recipients, [recipient, recipient]);
});

test("clarification preserves the original intent and prior answers, then reads Base ETH without signing", async () => {
  const repository = await createTestRepository();
  const address = `0x${"1".repeat(40)}`;
  let interpretations = 0,
    balanceReads = 0;
  const interpreter = {
    interpret: async (intent: string, turns: ClarificationTurn[] = []) => {
      interpretations++;
      assert.equal(intent, "I want to check my balance");
      if (turns.length < 2)
        return {
          outcome: "clarification",
          action: null,
          review: null,
          message: turns.length === 0 ? "Which asset?" : "Which network?",
        };
      assert.deepEqual(turns, [
        { question: "Which asset?", answer: "ETH" },
        { question: "Which network?", answer: "Base" },
      ]);
      return {
        outcome: "ready",
        action: { kind: "balance", network: "base", asset: "ETH" },
        review: null,
        message: "",
      };
    },
  } as unknown as IntentService;
  const base = {
    balance: async (account: string) => {
      assert.equal(account, address);
      balanceReads++;
      return { balance: "0.0123", symbol: "ETH" };
    },
  } as unknown as BaseProvider;
  const service = new ExecutionService(repository, interpreter, {} as TestnetProvider, {} as HederaProvider, base);
  const app = createNoobApp({ service, appOrigin: "http://localhost:3000", worker: false });
  const reply = (id: string, body: unknown, token?: string) =>
    app.fetch(
      new Request(`http://localhost:3001/api/noob/executions/${id}/clarify`, {
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
    const first = await service.start("I want to check my balance");
    const id = first.execution.id,
      token = first.accessToken;
    assert.equal((await reply(id, { answer: "ETH", version: 0 })).status, 401);
    assert.equal((await reply(id, { answer: "ETH", version: 0 }, "x".repeat(43))).status, 409);
    assert.equal((await reply(id, { answer: " ", version: 0 }, token)).status, 400);
    assert.equal((await reply(id, { answer: "ETH", version: 1 }, token)).status, 409);
    assert.equal(interpretations, 1);
    const secondResponse = await reply(id, { answer: "<div>ETH</div>", version: 0 }, token);
    assert.equal(secondResponse.status, 200);
    const second = (await secondResponse.json()).execution as Execution;
    assert.equal(second.intent, first.execution.intent);
    assert.equal(second.status, "clarification_required");
    assert.deepEqual((await service.get(id, token))?.clarifications, second.clarifications);
    assert.equal((await reply(id, { answer: "Base", version: 0 }, token)).status, 409);
    const thirdResponse = await reply(id, { answer: "Base", version: second.version }, token);
    assert.equal(thirdResponse.status, 200);
    const third = (await thirdResponse.json()).execution as Execution;
    assert.equal(third.status, "awaiting_wallet");
    assert.equal(await service.prepare(id, token), null);
    const wrong = await service.connectWallet(id, token, "0.0.1", null);
    assert.equal(wrong?.status, "awaiting_wallet");
    const bound = await service.connectWallet(id, token, "0.0.1", address);
    assert.equal(bound?.accountId, address);
    assert.equal(bound?.status, "approved");
    assert.equal(await service.clarify(id, token, "Hedera", bound!.version), null);
    const read = await service.prepare(id, token);
    assert.equal(read?.execution.status, "completed");
    assert.equal(read?.execution.interpretation.review?.title, "0.0123 ETH");
    assert.ok(read?.execution.interpretation.review?.facts.includes("Base Sepolia"));
    assert.equal(read?.execution.sourceTxHash, null);
    assert.equal(read?.execution.clarifications?.length, 2);
    assert.equal(balanceReads, 1);
    assert.equal(interpretations, 3);
  } finally {
    await repository.close();
  }
});

test("concurrent clarification replies cannot overwrite the winning context", async () => {
  const repository = await createTestRepository();
  let finish: (() => void) | undefined;
  const barrier = new Promise<void>(resolve => {
    finish = resolve;
  });
  const interpreter = {
    interpret: async (_intent: string, turns: ClarificationTurn[] = []) => {
      if (turns.length) await barrier;
      return { outcome: "clarification", action: null, review: null, message: "Which network?" };
    },
  } as unknown as IntentService;
  const service = new ExecutionService(repository, interpreter, {} as TestnetProvider, {} as HederaProvider);
  try {
    const start = await service.start("Check my balance");
    const replies = [
      service.clarify(start.execution.id, start.accessToken, "ETH", 0),
      service.clarify(start.execution.id, start.accessToken, "HBAR", 0),
    ];
    finish!();
    const results = await Promise.all(replies);
    assert.equal(results.filter(Boolean).length, 1);
    assert.equal((await service.get(start.execution.id, start.accessToken))?.clarifications?.length, 1);
    const revised = await service.revise(start.execution.id, start.accessToken, "Start again");
    assert.deepEqual(revised?.clarifications, []);
  } finally {
    await repository.close();
  }
});
