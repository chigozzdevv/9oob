import assert from "node:assert/strict";
import test from "node:test";
import type { Execution } from "@9oob/schema";
import { providerHarness } from "./wallet.fixture.js";

const initial: Execution = {
  id: "clarification-flow",
  intent: "I want to check my balance",
  accountId: null,
  evmAddress: null,
  status: "clarification_required",
  interpretation: { outcome: "clarification", message: "Which asset and network?", action: null, review: null },
  sourceTxHash: null,
  destinationTxHash: null,
  error: null,
  version: 0,
  createdAt: "2026-10-02T00:00:00Z",
  updatedAt: "2026-10-02T00:00:00Z",
};

test("answers a clarification in its own field and restores the original request with the saved answers", async () => {
  let state = initial;
  let connects = 0;
  let replyResponse: ((response: Response) => void) | undefined;
  const calls: string[] = [];
  const fetch = async (url: string, init?: RequestInit) => {
    calls.push(url);
    if (url.endsWith("/clarify")) {
      assert.deepEqual(JSON.parse(String(init?.body)), { answer: "ETH on Base", version: 0 });
      state = {
        ...state,
        status: "awaiting_wallet",
        version: 1,
        clarifications: [{ question: state.interpretation.message, answer: "ETH on Base" }],
        interpretation: {
          outcome: "ready",
          action: { kind: "balance", network: "base", asset: "ETH" },
          message: "",
          review: null,
        },
      };
      return new Promise<Response>(resolve => {
        replyResponse = resolve;
      });
    }
    return Response.json({
      execution: state,
      ...(url === "/api/noob/executions" ? { accessToken: "x".repeat(43) } : {}),
    });
  };
  const harness = providerHarness({
    connected: false,
    connect: () => {
      connects++;
    },
    fetch,
  });
  await harness.flush();
  harness.start(initial.intent);
  await harness.flush();
  assert.match(harness.text(), /I want to check my balance/);
  assert.match(harness.text(), /Which asset and network/);
  assert.equal(
    harness.nodes().some(node => node.props.role === "log" && node.props["aria-label"] === "Intent conversation"),
    true,
  );
  assert.equal(harness.nodes().filter(node => node.type === "textarea").length, 1);
  assert.equal(harness.buttons().find(button => button.props["aria-label"] === "Send details")?.props.disabled, true);
  await harness.fillReply("<div>ETH on Base</div>");
  await harness.click("Send details");
  assert.match(harness.text(), /ETH on Base/);
  assert.equal(harness.nodes().find(node => node.type === "textarea")?.props.value, "");
  assert.equal(
    harness.nodes().some(node => node.props["aria-label"] === "Loading reply"),
    true,
  );
  replyResponse!(Response.json({ execution: state }));
  await harness.flush();
  assert.equal(harness.state()?.execution?.intent, initial.intent);
  assert.match(harness.text(), /ETH on Base/);
  assert.match(harness.text(), /Connect a Base Sepolia wallet/);
  assert.equal(connects, 0);
  await harness.click("Connect wallet");
  assert.equal(connects, 1);
  assert.match(harness.text(), /I want to check my balance/);
  assert.match(harness.text(), /ETH on Base/);
  assert.equal(calls.filter(url => url === "/api/noob/executions").length, 1);
  const storage = harness.storage;
  harness.unmount();
  const restored = providerHarness({ connected: false, storage, fetch });
  await restored.flush();
  assert.match(restored.text(), /I want to check my balance/);
  assert.match(restored.text(), /ETH on Base/);
  assert.equal(restored.state()?.execution?.status, "awaiting_wallet");
  assert.equal(restored.nodes().filter(node => node.props.className?.includes("noob-user")).length, 2);
  restored.unmount();
});

test("a failed clarification keeps its draft and context for retry", async () => {
  let replies = 0;
  const harness = providerHarness({
    connected: false,
    fetch: async url => {
      if (url.endsWith("/clarify")) {
        replies++;
        return Response.json({ error: "Temporarily unavailable" }, { status: 502 });
      }
      return Response.json({ execution: initial, accessToken: "x".repeat(43) });
    },
  });
  await harness.flush();
  harness.start(initial.intent);
  await harness.flush();
  await harness.fillReply("ETH on Base");
  await harness.click("Send details");
  assert.match(harness.text(), /Temporarily unavailable/);
  assert.equal(harness.nodes().find(node => node.type === "textarea")?.props.value, "ETH on Base");
  assert.equal(harness.state()?.execution?.intent, initial.intent);
  await harness.click("Send details");
  assert.equal(replies, 2);
  harness.unmount();
});

test("Base ETH reads bind the EVM address without requiring a signer, network switch or approval", async () => {
  const address = `0x${"1".repeat(40)}`;
  let state: Execution = {
    ...initial,
    status: "awaiting_wallet",
    interpretation: {
      outcome: "ready",
      action: { kind: "balance", network: "base", asset: "ETH" },
      message: "",
      review: null,
    },
  };
  const calls: string[] = [];
  const harness = providerHarness({
    nativeAccount: "0.0.1",
    evmReady: false,
    isConnecting: true,
    chainId: 1,
    switchChain: async () => {
      throw new Error("Read must not switch networks");
    },
    fetch: async (url, init) => {
      calls.push(url);
      if (url === "/api/noob/executions") return Response.json({ execution: state, accessToken: "x".repeat(43) });
      if (url.endsWith("/wallet")) {
        assert.deepEqual(JSON.parse(String(init?.body)), { accountId: address, evmAddress: address });
        state = { ...state, accountId: address, evmAddress: address, status: "approved", version: 1 };
        return Response.json({ execution: state });
      }
      if (url.endsWith("/prepare")) {
        state = { ...state, status: "completed", version: 2 };
        return Response.json({ execution: state, step: { kind: "read" } });
      }
      throw new Error(`Unexpected request ${url}`);
    },
  });
  await harness.flush();
  const result = harness.start("Check my Base ETH balance");
  await harness.flush();
  assert.equal(result.resolved?.status, "completed");
  assert.equal(result.resolved?.sourceTxHash, null);
  assert.deepEqual(calls, [
    "/api/noob/executions",
    "/api/noob/executions/clarification-flow/wallet",
    "/api/noob/executions/clarification-flow/prepare",
  ]);
  harness.unmount();
});
