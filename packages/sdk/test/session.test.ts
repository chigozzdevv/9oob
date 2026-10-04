import { SESSION_KEY, readSession, saveSession } from "../src/execution/session.js";
import { MemoryStorage, providerHarness } from "./wallet.fixture.js";
import type { Execution } from "@9oob/schema";
import assert from "node:assert/strict";
import test from "node:test";

const address = `0x${"1".repeat(40)}`;
const txHash = `0x${"a".repeat(64)}`;
const accessToken = "x".repeat(43);
const baseExecution: Execution = {
  id: "execution-1",
  intent: "Bridge 1 USDC",
  accountId: "0.0.1",
  evmAddress: address,
  status: "awaiting_approval",
  interpretation: {
    outcome: "ready",
    action: {
      kind: "bridge",
      sourceNetwork: "base",
      destinationNetwork: "hedera",
      sourceAsset: "USDC",
      destinationAsset: "USDC",
      amount: "1",
      recipient: address,
    },
    message: "",
    review: { title: "Bridge 1 USDC", facts: [], quote: null },
  },
  sourceTxHash: null,
  destinationTxHash: null,
  error: null,
  version: 0,
  createdAt: "2026-10-02T00:00:00Z",
  updatedAt: "2026-10-02T00:00:00Z",
};

function backend(native = false) {
  let execution: Execution = native
    ? {
        ...baseExecution,
        intent: "Send 1 HBAR",
        interpretation: {
          ...baseExecution.interpretation,
          action: {
            kind: "transfer",
            network: "hedera",
            asset: "HBAR",
            amount: "1",
            recipient: "0.0.2",
          },
        },
      }
    : { ...baseExecution };
  const calls = { create: 0, prepare: 0, register: 0, get: 0 };
  const faults = {
    register: false,
    read: false,
    lostRegistrationResponse: false,
  };
  const step = () =>
    native
      ? {
          kind: "hedera-transfer",
          accountId: "0.0.1",
          asset: "HBAR",
          recipient: "0.0.2",
          amount: "100000000",
          network: "testnet",
        }
      : {
          kind: "source",
          chainKey: "base",
          transaction: {
            from: address,
            to: `0x${"2".repeat(40)}`,
            data: `0x0${calls.prepare}`,
            value: "0",
          },
        };
  const fetch = async (url: string, init: RequestInit = {}) => {
    if (url === "/api/noob/executions") {
      calls.create++;
      return Response.json({ execution, accessToken });
    }
    if (url.endsWith("/approve")) {
      execution = {
        ...execution,
        status: "approved",
        version: execution.version + 1,
      };
      return Response.json({ execution });
    }
    if (url.endsWith("/prepare")) {
      calls.prepare++;
      execution = {
        ...execution,
        status: "awaiting_signature",
        version: execution.version + 1,
      };
      return Response.json({ execution, step: step() });
    }
    if (url.endsWith("/submitted")) {
      calls.register++;
      if (faults.register) return Response.json({ error: "Temporary registration outage" }, { status: 503 });
      const body = JSON.parse(String(init.body)) as {
        txHash: string;
        preparationVersion: number;
      };
      assert.equal(typeof body.preparationVersion, "number");
      if (execution.status === "awaiting_signature") assert.equal(body.preparationVersion, execution.version);
      execution = {
        ...execution,
        status: "submitted",
        sourceTxHash: body.txHash,
        version: execution.version + 1,
      };
      if (faults.lostRegistrationResponse) return Response.json({ error: "Response lost" }, { status: 503 });
      return Response.json({ execution });
    }
    calls.get++;
    if (faults.read) return Response.json({ error: "Temporary read outage" }, { status: 503 });
    return Response.json({ execution, step: step() });
  };
  return {
    fetch,
    calls,
    faults,
    execution: () => execution,
    setExecution: (next: Execution) => {
      execution = next;
    },
  };
}

function saved(execution: Execution, storage = new MemoryStorage()) {
  saveSession(storage, {
    id: execution.id,
    accessToken,
    intent: execution.intent,
  });
  return storage;
}

test("keeps the initial request alive across the busy render", async () => {
  let respond!: (value: Response) => void;
  let calls = 0;
  const h = providerHarness({
    fetch: async () => {
      calls++;
      return new Promise(resolve => {
        respond = resolve;
      });
    },
  });
  await h.flush();
  h.start();
  await h.flush();
  assert.equal(h.state()?.busy, true);
  respond(Response.json({ execution: baseExecution, accessToken }));
  await h.flush();
  assert.equal(h.state()?.execution?.status, "awaiting_approval");
  assert.equal(h.state()?.busy, false);
  assert.equal(readSession(h.storage)?.id, baseExecution.id);
  assert.equal(calls, 1);
  h.unmount();
});

for (const lostResponse of [false, true]) {
  test(`persists a broadcast hash and retries registration without another wallet send (lost response: ${lostResponse})`, async () => {
    const api = backend();
    let sends = 0;
    api.faults.register = !lostResponse;
    api.faults.lostRegistrationResponse = lostResponse;
    const h = providerHarness({
      fetch: api.fetch,
      evmSend: async () => {
        sends++;
        return txHash;
      },
    });
    await h.flush();
    h.start();
    await h.flush();
    await h.click("Approve and continue");
    assert.equal(sends, 1);
    assert.equal(readSession(h.storage)?.pendingSubmission?.txHash, txHash);
    assert(!h.text().includes("Sign transaction"));
    api.faults.register = false;
    api.faults.lostRegistrationResponse = false;
    await h.tick();
    assert.equal(h.state()?.execution?.status, "submitted");
    assert.equal(h.state()?.pendingSubmission, undefined);
    assert.equal(readSession(h.storage)?.pendingSubmission, undefined);
    assert.equal(sends, 1);
    assert.equal(api.calls.prepare, 1);
    h.unmount();
  });
}

test("retains the execution capability during an offline reload and retries recovery", async () => {
  const api = backend();
  api.faults.read = true;
  const storage = saved(baseExecution);
  const h = providerHarness({ storage, fetch: api.fetch });
  await h.flush();
  assert.equal(readSession(storage)?.id, baseExecution.id);
  assert.match(h.text(), /Try again/);
  const rejected = h.start();
  assert.match(rejected.rejected!.message, /active/);
  api.faults.read = false;
  await h.click("Try again");
  assert.equal(h.state()?.execution?.id, baseExecution.id);
  assert.equal(api.calls.create, 0);
  h.unmount();
});

test("retries restored native signatures after refreshing their prepared step", async () => {
  const api = backend(true);
  const execution = {
    ...api.execution(),
    status: "awaiting_signature" as const,
    version: 1,
  };
  api.setExecution(execution);
  let sends = 0;
  const h = providerHarness({
    storage: saved(execution),
    nativeAccount: "0.0.1",
    fetch: api.fetch,
    nativeSend: async () => {
      if (++sends === 1) throw { code: 4001, message: "User rejected" };
      return { transactionId: "0.0.1@1800000000.000000001" };
    },
  });
  await h.flush();
  await h.click("Sign transaction");
  assert.equal(h.state()?.pendingSubmission, undefined);
  assert.equal(readSession(h.storage)?.pendingSubmission, undefined);
  await h.click("Sign transaction");
  assert.equal(api.calls.prepare, 2);
  assert.equal(sends, 2);
  assert.equal(h.state()?.execution?.status, "submitted");
  h.unmount();
});

test("recovers an unknown wallet outcome from its transaction reference without signing again", async () => {
  const api = backend();
  let sends = 0;
  const first = providerHarness({
    fetch: api.fetch,
    evmSend: async () => {
      sends++;
      throw new Error("Wallet connection lost");
    },
  });
  await first.flush();
  first.start();
  await first.flush();
  await first.click("Approve and continue");
  assert.equal(readSession(first.storage)?.pendingSubmission?.txHash, undefined);
  assert.equal(readSession(first.storage)?.pendingSubmission?.preparationVersion, api.execution().version);
  first.unmount();
  const restored = providerHarness({
    storage: first.storage,
    fetch: api.fetch,
  });
  await restored.flush();
  assert(!restored.text().includes("Sign transaction"));
  const input = restored.nodes().find(node => node.props["aria-label"] === "Wallet transaction reference")!;
  input.props.onChange({ target: { value: txHash } });
  await restored.flush();
  await restored.click("Recover transaction");
  assert.equal(restored.state()?.execution?.status, "submitted");
  assert.equal(sends, 1);
  assert.equal(api.calls.prepare, 1);
  restored.unmount();
});

test("blocks wallet calls when their recovery journal cannot be saved", async () => {
  const api = backend();
  let sends = 0;
  const h = providerHarness({
    fetch: api.fetch,
    evmSend: async () => {
      sends++;
      return txHash;
    },
  });
  await h.flush();
  h.start();
  await h.flush();
  h.storage.failWrites = true;
  await h.click("Approve and continue");
  assert.equal(sends, 0);
  assert.match(h.state()?.error!, /Storage unavailable/);
  h.unmount();
});

test("retains a returned hash in memory when storage fails after the wallet responds", async () => {
  const api = backend();
  let sends = 0;
  const h = providerHarness({
    fetch: api.fetch,
    evmSend: async () => {
      sends++;
      h.storage.failWrites = true;
      return txHash;
    },
  });
  await h.flush();
  h.start();
  await h.flush();
  await h.click("Approve and continue");
  assert.equal(h.state()?.pendingSubmission?.txHash, txHash);
  assert(!h.text().includes("Sign transaction"));
  h.storage.failWrites = false;
  await h.click("Check progress");
  assert.equal(h.state()?.execution?.status, "submitted");
  assert.equal(sends, 1);
  assert.equal(api.calls.prepare, 1);
  h.unmount();
});

test("permits a fresh native signature when no signer was available", async () => {
  const api = backend(true);
  let calls = 0;
  const h = providerHarness({
    fetch: api.fetch,
    nativeAccount: "0.0.1",
    nativeSend: async () => {
      if (++calls === 1)
        throw {
          name: "CapabilityError",
          message: "Connect a native Hedera wallet",
        };
      return { transactionId: "0.0.1@1800000000.000000001" };
    },
  });
  await h.flush();
  h.start("Send 1 HBAR");
  await h.flush();
  await h.click("Approve and continue");
  assert.equal(h.state()?.pendingSubmission, undefined);
  assert.match(h.text(), /Connect a native Hedera wallet/);
  await h.click("Sign transaction");
  assert.equal(h.state()?.execution?.status, "submitted");
  assert.equal(api.calls.prepare, 2);
  h.unmount();
});

test("shows a persisted failure and its recovery reason", async () => {
  const api = backend();
  api.setExecution({
    ...baseExecution,
    status: "failed",
    version: 4,
    error: "The source transaction failed on-chain",
  });
  const h = providerHarness({
    storage: saved(baseExecution),
    fetch: api.fetch,
  });
  await h.flush();
  const error = h.nodes().find(node => node.props.role === "status" && node.props.className === "noob-error")!;
  assert.equal(error.props.children, "The source transaction failed on-chain");
  assert.match(h.text(), /source transaction failed on-chain/);
  assert.match(h.text(), /Failed/);
  h.unmount();
});

test("closing an unsent run releases its caller and permits another intent", async () => {
  let calls = 0;
  const h = providerHarness({
    connected: false,
    fetch: async (_url, init) => {
      calls++;
      assert.equal(JSON.parse(String(init?.body)).accountId, null);
      throw new Error("Temporary interpretation outage");
    },
  });
  await h.flush();
  const first = h.start();
  await h.flush();
  await h.click("Close");
  assert.match(first.rejected!.message, /cancelled/);
  assert.equal(h.state(), undefined);
  assert.equal(h.start("A different intent").rejected, undefined);
  await h.flush();
  assert.equal(calls, 2);
  h.unmount();
});

test("preserves known submission hashes across reload and never opens a wallet", async () => {
  const api = backend();
  const execution = {
    ...baseExecution,
    status: "awaiting_signature" as const,
    version: 2,
  };
  api.setExecution(execution);
  const storage = saved(execution);
  saveSession(storage, {
    id: execution.id,
    accessToken,
    pendingSubmission: { preparationVersion: 2, network: "evm", txHash },
  });
  const h = providerHarness({ storage, fetch: api.fetch });
  await h.flush();
  assert.equal(h.state()?.execution?.status, "submitted");
  assert.equal(api.calls.prepare, 0);
  assert.equal(api.calls.register, 1);
  assert.equal(storage.getItem(SESSION_KEY) !== null, true);
  h.unmount();
});
