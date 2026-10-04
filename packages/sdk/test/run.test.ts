import assert from "node:assert/strict";
import test from "node:test";
import { ExecutionSchema } from "@9oob/schema";
import { noob } from "../src/run.js";
import { subscribeToNoobRequests, type NoobRequest } from "../src/transport/events.js";

test("rejects blank or oversized intents before dispatch", async () => {
  await assert.rejects(noob.run("   "), /1 to 2,000 characters/);
  await assert.rejects(noob.run("a".repeat(2001)), /1 to 2,000 characters/);
});

test("requires exactly one mounted execution provider", async () => {
  await assert.rejects(noob.run("Check my HBAR balance"), /Mount <NoobProvider>/);
  let calls = 0;
  const first = subscribeToNoobRequests(() => {
    calls += 1;
  });
  const second = subscribeToNoobRequests(() => {
    calls += 1;
  });
  try {
    await assert.rejects(noob.run("Check my HBAR balance"), /exactly one <NoobProvider>/);
    assert.equal(calls, 0);
  } finally {
    first();
    second();
  }
});

test("dispatches once and resolves with the completed execution", async () => {
  let request: NoobRequest | undefined;
  const unsubscribe = subscribeToNoobRequests(value => {
    request = value;
  });
  try {
    const pending = noob.run('<div><br class="Apple-interchange-newline">Check my HBAR balance</div>');
    assert.equal(request?.intent, "Check my HBAR balance");
    const execution = ExecutionSchema.parse({
      id: "execution-1",
      intent: "Check my HBAR balance",
      accountId: "0.0.123",
      evmAddress: null,
      status: "completed",
      interpretation: { outcome: "unsupported", action: null, message: "", review: null },
      sourceTxHash: null,
      destinationTxHash: null,
      error: null,
      version: 1,
      createdAt: new Date(0).toISOString(),
      updatedAt: new Date(0).toISOString(),
    });
    request?.resolve(execution);
    assert.equal(await pending, execution);
  } finally {
    unsubscribe();
  }
});
