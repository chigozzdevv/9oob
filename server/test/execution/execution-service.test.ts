import { createTestRepository } from "../support/database.js";
import { ExecutionService } from "../../src/features/execution/execution.service.js";
import { IntentService } from "../../src/features/intent/intent.service.js";
import { HederaProvider } from "../../src/shared/integration/hedera/hedera.client.js";
import {
  ReviewRequiredError,
  type RoutePreparation,
  TestnetProvider,
} from "../../src/shared/integration/testnet.provider.js";
import { createCapability } from "../../src/shared/auth/auth.service.js";
import type { IntentAction, Interpretation } from "@9oob/schema";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { encodeAbiParameters, encodeEventTopics } from "viem";
import { tokenAbi, tokenAddress } from "../../src/shared/integration/evm/token.js";

const address = `0x${"1".repeat(40)}` as const;
const txHash = `0x${"a".repeat(64)}`;
const transaction = {
  from: address,
  to: `0x${"2".repeat(40)}` as const,
  data: "0x1234" as const,
  value: "0",
};
const transfer: IntentAction = {
  kind: "transfer",
  network: "hedera",
  asset: "HBAR",
  amount: "1",
  recipient: "0.0.2",
};
const swap: IntentAction = {
  kind: "swap",
  sourceNetwork: "base",
  destinationNetwork: "hedera",
  sourceAsset: "USDC",
  destinationAsset: "USDC",
  amount: "1",
  recipient: address,
};
const review = {
  title: "Reviewed action",
  facts: [],
  quote: { amountRaw: "1000000", amountDecimals: 6, amountSymbol: "USDC" },
};
const preparation = (phase: "source" | "approval" = "source"): RoutePreparation => ({
  phase,
  label: "Transaction",
  transaction,
  context: { kind: "swap", sourceChainKey: "base", phase },
});

async function fixture(action: IntentAction = transfer) {
  const directory = await mkdtemp(join(tmpdir(), "9oob-service-"));
  const store = await createTestRepository(join(directory, "data"));
  const capability = createCapability();
  const interpretation: Interpretation = {
    outcome: "ready",
    action,
    message: "",
    review,
  };
  await store.create({
    ...capability,
    intent: "Reviewed intent",
    accountId: "0.0.1",
    evmAddress: address,
    status: "approved",
    interpretation,
  });
  return {
    store,
    capability,
    interpretation,
    service: (routes: Partial<TestnetProvider> = {}, hedera: Partial<HederaProvider> = {}) =>
      new ExecutionService(
        store,
        {} as IntentService,
        routes as TestnetProvider,
        {
          account: async (account: string) => ({ account }),
          ...hedera,
        } as HederaProvider,
      ),
    dispose: async () => {
      await store.close();
      await rm(directory, { recursive: true, force: true });
    },
  };
}

test("repairs legacy signature state with no prepared context", async () => {
  const f = await fixture();
  try {
    await f.store.transition(f.capability.id, f.capability.tokenHash, ["approved"], { status: "awaiting_signature" });
    const prepared = await f.service().prepare(f.capability.id, f.capability.token);
    assert.equal(prepared?.execution.status, "awaiting_signature");
    assert.equal(prepared?.step.kind, "hedera-transfer");
    assert.deepEqual((await f.store.getContext(f.capability.id, f.capability.tokenHash))?.step, prepared?.step);
  } finally {
    await f.dispose();
  }
});

test("concurrent receipt reconciliation returns the persisted winner to every reader", async () => {
  const f = await fixture();
  try {
    let calls = 0;
    let release!: () => void;
    const bothChecking = new Promise<void>(resolve => {
      release = resolve;
    });
    const service = f.service(
      {},
      {
        transactionStatus: async () => {
          if (++calls === 2) release();
          await bothChecking;
          return "success";
        },
      },
    );
    const prepared = (await service.prepare(f.capability.id, f.capability.token))!;
    const reference = "0.0.1@1000000000.123456789";
    await service.registerSubmission(f.capability.id, f.capability.token, reference, prepared.execution.version);
    const [reader, worker] = await Promise.all([
      service.read(f.capability.id, f.capability.token),
      service.refreshStored(f.capability.id, f.capability.tokenHash),
    ]);
    assert.equal(reader?.execution.status, "completed");
    assert.equal(worker?.status, "completed");
    assert.equal(reader?.execution.version, worker?.version);
    assert.deepEqual(reader?.execution.completedSteps, [{ stage: "transfer", network: "hedera", txHash: reference }]);
    assert.equal(reader?.execution.sourceTxHash, reference);
    assert.equal(await service.refresh(f.capability.id, "wrong-token"), null);
  } finally {
    await f.dispose();
  }
});

test("keeps preparation private until it commits and respects cancellation", async () => {
  const f = await fixture(swap);
  try {
    let release!: (value: RoutePreparation) => void;
    let entered!: () => void;
    const entering = new Promise<void>(resolve => {
      entered = resolve;
    });
    const service = f.service({
      prepare: async () => {
        entered();
        return new Promise(resolve => {
          release = resolve;
        });
      },
    });
    const pending = service.prepare(f.capability.id, f.capability.token);
    await entering;
    assert.equal((await service.get(f.capability.id, f.capability.token))?.status, "approved");
    assert.equal(await f.store.getContext(f.capability.id, f.capability.tokenHash), null);
    assert.equal((await service.cancel(f.capability.id, f.capability.token))?.status, "cancelled");
    release(preparation());
    assert.equal(await pending, null);
    assert.equal(await f.store.getContext(f.capability.id, f.capability.tokenHash), null);
  } finally {
    await f.dispose();
  }
});

test("refreshes unsigned steps and rejects stale transaction versions", async () => {
  const f = await fixture(swap);
  try {
    let calls = 0;
    const service = f.service({
      prepare: async () => ({
        ...preparation(),
        transaction: { ...transaction, data: `0x0${++calls}` as `0x${string}` },
      }),
    });
    const first = (await service.prepare(f.capability.id, f.capability.token))!;
    const second = (await service.prepare(f.capability.id, f.capability.token))!;
    assert.notEqual(first.step.transaction, second.step.transaction);
    assert.equal(calls, 2);
    assert.equal(
      await service.registerSubmission(f.capability.id, f.capability.token, txHash, first.execution.version),
      null,
    );
    assert.equal(
      (await service.registerSubmission(f.capability.id, f.capability.token, txHash, second.execution.version))?.status,
      "submitted",
    );
    assert.equal(await service.prepare(f.capability.id, f.capability.token), null);
    assert.equal(calls, 2);
  } finally {
    await f.dispose();
  }
});

test("requires approval of a refreshed quote before another wallet step", async () => {
  const f = await fixture(swap);
  try {
    const nextReview = {
      ...review,
      quote: { ...review.quote, amountRaw: "900000" },
    };
    const service = f.service({
      prepare: async () => {
        throw new ReviewRequiredError(nextReview);
      },
    });
    const result = await service.prepare(f.capability.id, f.capability.token);
    assert.equal(result?.execution.status, "awaiting_approval");
    assert.equal(result?.execution.interpretation.review?.quote?.amountRaw, "900000");
    assert.equal(result?.step.kind, "error");
    assert.deepEqual((await f.store.getContext(f.capability.id, f.capability.tokenHash))?.stageReview, nextReview);
  } finally {
    await f.dispose();
  }
});

test("acknowledges an old approval registration after its hash was cleared", async () => {
  const f = await fixture(swap);
  try {
    let phase: "source" | "approval" = "approval";
    const service = f.service({ prepare: async () => preparation(phase) });
    const approved = (await service.prepare(f.capability.id, f.capability.token))!;
    await service.registerSubmission(f.capability.id, f.capability.token, txHash, approved.execution.version);
    await f.store.transition(f.capability.id, f.capability.tokenHash, ["submitted"], {
      status: "approved",
      sourceTxHash: null,
    });
    assert.equal(
      (await service.registerSubmission(f.capability.id, f.capability.token, txHash, approved.execution.version))
        ?.status,
      "approved",
    );
    phase = "source";
    const source = (await service.prepare(f.capability.id, f.capability.token))!;
    assert.equal(
      (await service.registerSubmission(f.capability.id, f.capability.token, txHash, approved.execution.version))
        ?.version,
      source.execution.version,
    );
    assert.equal((await service.get(f.capability.id, f.capability.token))?.sourceTxHash, null);
    assert.equal(
      await service.registerSubmission(f.capability.id, "wrong-token", txHash, approved.execution.version),
      null,
    );
  } finally {
    await f.dispose();
  }
});

test("rolls back a preparation when its context cannot be persisted", async () => {
  const f = await fixture();
  try {
    const context: Record<string, unknown> = {};
    context.self = context;
    await assert.rejects(f.store.commitPreparation(f.capability.id, f.capability.tokenHash, 0, context), /circular/);
    const execution = await f.store.get(f.capability.id, f.capability.tokenHash);
    assert.equal(execution?.status, "approved");
    assert.equal(execution?.version, 0);
    assert.equal(await f.store.getContext(f.capability.id, f.capability.tokenHash), null);
  } finally {
    await f.dispose();
  }
});

test("resolves the declared server subpath exports", async () => {
  assert.equal((await import("@9oob/server/execution")).ExecutionService, ExecutionService);
  assert.equal((await import("@9oob/server/intents")).IntentService, IntentService);
});

test("a settled swap retains its receipt through an outage and advances once without preparing it again", async () => {
  const action: IntentAction = {
    kind: "swap",
    sourceNetwork: "hedera",
    destinationNetwork: "base",
    sourceAsset: "HBAR",
    destinationAsset: "USDC",
    amount: "10",
    recipient: address,
  };
  const f = await fixture(action);
  const originalFetch = globalThis.fetch;
  try {
    let prepareCalls = 0,
      nextCalls = 0;
    globalThis.fetch = async (_url, init) => {
      const { method } = JSON.parse(String(init?.body));
      return Response.json({
        id: 1,
        result:
          method === "eth_chainId"
            ? "0x128"
            : method === "eth_getTransactionByHash"
              ? { ...transaction, input: transaction.data, value: "0x0" }
              : { status: "0x1", blockNumber: "0x10", transactionHash: txHash, logs: [] },
      });
    };
    const routes = {
      prepare: async () => {
        prepareCalls++;
        return {
          ...preparation(),
          context: {
            provider: "saucerswap",
            sourceChainKey: "hedera",
            stage: "swap",
            routeStages: [action, { ...action, kind: "bridge" }],
            stageIndex: 0,
          },
        };
      },
      saucer: { rpc: { receipt: async () => ({ status: "0x1", logs: [] }) }, received: () => 1_000_000n },
      next: async () => {
        if (++nextCalls === 1) throw new Error("Temporary bridge outage");
        return {
          review,
          context: {
            provider: "layerzero",
            stage: "bridge",
            sourceChainKey: "hedera",
            routeStages: [action, { ...action, kind: "bridge" }],
            stageIndex: 1,
          },
        };
      },
    } as unknown as TestnetProvider;
    const service = f.service(routes);
    const prepared = (await service.prepare(f.capability.id, f.capability.token))!;
    await service.registerSubmission(f.capability.id, f.capability.token, txHash, prepared.execution.version);
    await assert.rejects(service.refresh(f.capability.id, f.capability.token), /outage/);
    assert.equal((await service.get(f.capability.id, f.capability.token))?.status, "submitted");
    assert.equal(await service.prepare(f.capability.id, f.capability.token), null);
    const next = await service.refresh(f.capability.id, f.capability.token);
    assert.equal(next?.status, "awaiting_approval");
    assert.equal(next?.stage, "bridge");
    assert.equal(next?.completedSteps?.[0].txHash, txHash);
    assert.equal(next?.completedSteps?.[0].amountRaw, "1000000");
    assert.equal(prepareCalls, 1);
    assert.equal((await service.refresh(f.capability.id, f.capability.token))?.version, next?.version);
    assert.equal(await service.revise(f.capability.id, f.capability.token, "Send different funds"), null);
  } finally {
    globalThis.fetch = originalFetch;
    await f.dispose();
  }
});

test("bridge recovery waits for destination proof and persists a claim step instead of resubmitting source funds", async () => {
  const f = await fixture(swap);
  try {
    let statusCalls = 0;
    const service = f.service({
      status: async () =>
        ++statusCalls === 1
          ? {
              status: "pending",
              context: {
                provider: "layerzero",
                sourceNetwork: "base",
                destinationNetwork: "hedera",
                sourceChainKey: "base",
                guid: "0xguid",
                bridgeSourceHash: txHash,
              },
            }
          : {
              status: "pending",
              claimReady: true,
              context: {
                provider: "layerzero",
                sourceNetwork: "base",
                destinationNetwork: "hedera",
                sourceChainKey: "base",
                guid: "0xguid",
                bridgeSourceHash: txHash,
              },
            },
    });
    await f.store.transition(f.capability.id, f.capability.tokenHash, ["approved"], {
      status: "settling",
      sourceTxHash: txHash,
    });
    await f.store.setContext(f.capability.id, f.capability.tokenHash, {
      provider: "layerzero",
      sourceNetwork: "base",
      destinationNetwork: "hedera",
      sourceChainKey: "base",
    });
    assert.equal((await service.refresh(f.capability.id, f.capability.token))?.status, "settling");
    const claim = await service.refresh(f.capability.id, f.capability.token);
    assert.equal(claim?.stage, "claim");
    assert.equal(claim?.stageNetwork, "hedera");
    assert.equal(claim?.status, "approved");
    assert.equal(claim?.sourceTxHash, null);
    const context = await f.store.getContext(f.capability.id, f.capability.tokenHash);
    assert.equal(context?.claimPending, true);
    assert.equal(context?.bridgeSourceHash, txHash);
    assert.equal(context?.guid, "0xguid");
  } finally {
    await f.dispose();
  }
});

test("a foreign transaction cannot complete the reviewed EVM step", async () => {
  const f = await fixture(swap);
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async (_url, init) => {
      const { method } = JSON.parse(String(init?.body));
      return Response.json({
        id: 1,
        result:
          method === "eth_chainId"
            ? "0x14a34"
            : { ...transaction, from: `0x${"9".repeat(40)}`, input: transaction.data, value: "0x0" },
      });
    };
    const service = f.service({ prepare: async () => preparation() });
    const prepared = (await service.prepare(f.capability.id, f.capability.token))!;
    await service.registerSubmission(f.capability.id, f.capability.token, txHash, prepared.execution.version);
    assert.equal((await service.refresh(f.capability.id, f.capability.token))?.status, "failed");
    assert.match((await service.get(f.capability.id, f.capability.token))!.error!, /does not match/);
  } finally {
    globalThis.fetch = originalFetch;
    await f.dispose();
  }
});

test("revising an unsigned intent atomically discards its old prepared route", async () => {
  const f = await fixture();
  try {
    await f.store.setContext(f.capability.id, f.capability.tokenHash, {
      stageIndex: 1,
      routeStages: [swap],
      stageReview: review,
    });
    const interpreter = { interpret: async () => f.interpretation } as unknown as IntentService;
    const hedera = { account: async (account: string) => ({ account }) } as unknown as HederaProvider;
    const service = new ExecutionService(f.store, interpreter, {} as TestnetProvider, hedera);
    const revised = await service.revise(f.capability.id, f.capability.token, "Send one HBAR instead");
    assert.equal(revised?.status, "awaiting_approval");
    assert.equal(revised?.stage, null);
    assert.deepEqual(await f.store.getContext(f.capability.id, f.capability.tokenHash), {});
  } finally {
    await f.dispose();
  }
});

test("an EVM Hedera transfer survives restart and completes only with its exact transaction and token receipt", async () => {
  const f = await fixture({ ...transfer, asset: "USDC" });
  const originalFetch = globalThis.fetch;
  const recipient = transaction.to;
  const token = tokenAddress("hedera", "USDC");
  try {
    let reads = 0,
      mined = false,
      receiptAmount = 1_000_000n;
    let preparedTransaction: typeof transaction;
    globalThis.fetch = async (_url, init) => {
      const { method, params } = JSON.parse(String(init?.body));
      assert(!method.startsWith("eth_send"));
      if (method === "eth_call") {
        reads++;
        preparedTransaction = params[0];
      }
      return Response.json({
        id: 1,
        result:
          method === "eth_chainId"
            ? "0x128"
            : method === "eth_call"
              ? encodeAbiParameters([{ type: "bool" }], [true])
              : method === "eth_getTransactionByHash"
                ? { ...preparedTransaction!, input: preparedTransaction!.data, value: "0x0" }
                : mined
                  ? {
                      status: "0x1",
                      blockNumber: "0x10",
                      transactionHash: txHash,
                      logs: [
                        {
                          address: token,
                          topics: encodeEventTopics({
                            abi: tokenAbi,
                            eventName: "Transfer",
                            args: { from: address, to: recipient },
                          }),
                          data: encodeAbiParameters([{ type: "uint256" }], [receiptAmount]),
                        },
                      ],
                    }
                  : null,
      });
    };
    await f.store.transition(f.capability.id, f.capability.tokenHash, ["approved"], { accountId: address });
    const hedera = {
      account: async (value: string) => ({
        account: value === address ? "0.0.1" : "0.0.2",
        evm_address: value === address ? address : recipient,
      }),
      token: async () => ({ token_id: "0.0.5449", type: "FUNGIBLE_COMMON", decimals: "6", symbol: "USDC" }),
      assertTokenAssociated: async () => undefined,
    } as unknown as HederaProvider;
    const service = f.service({}, hedera);
    const prepared = (await service.prepare(f.capability.id, f.capability.token))!;
    assert.equal(prepared.step.kind, "source");
    assert.equal((await f.store.getContext(f.capability.id, f.capability.tokenHash))?.kind, "hedera-evm-transfer");
    await assert.rejects(
      service.registerSubmission(f.capability.id, f.capability.token, "0.0.1@100.1", prepared.execution.version),
      /reference/,
    );
    await service.registerSubmission(f.capability.id, f.capability.token, txHash, prepared.execution.version);
    assert.equal(await service.prepare(f.capability.id, f.capability.token), null);
    const restored = f.service({}, hedera);
    assert.equal((await restored.refresh(f.capability.id, f.capability.token))?.status, "submitted");
    assert.equal(reads, 1);
    mined = true;
    const completed = await restored.refresh(f.capability.id, f.capability.token);
    assert.equal(completed?.status, "completed");
    assert.deepEqual(completed?.completedSteps, [{ stage: "transfer", network: "hedera", txHash }]);
    assert.equal(
      (await restored.registerSubmission(f.capability.id, f.capability.token, txHash, prepared.execution.version))
        ?.status,
      "completed",
    );
    assert.equal(reads, 1);
    const wrong = await fixture({ ...transfer, asset: "USDC" });
    try {
      await wrong.store.transition(wrong.capability.id, wrong.capability.tokenHash, ["approved"], {
        accountId: address,
      });
      const incorrect = wrong.service({}, hedera);
      const step = (await incorrect.prepare(wrong.capability.id, wrong.capability.token))!;
      await incorrect.registerSubmission(wrong.capability.id, wrong.capability.token, txHash, step.execution.version);
      receiptAmount = 999_999n;
      assert.equal((await incorrect.refresh(wrong.capability.id, wrong.capability.token))?.status, "failed");
    } finally {
      await wrong.dispose();
    }
  } finally {
    globalThis.fetch = originalFetch;
    await f.dispose();
  }
});
