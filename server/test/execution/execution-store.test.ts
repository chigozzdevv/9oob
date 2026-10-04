import { createTestRepository } from "../support/database.js";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { ExecutionRepository } from "../../src/features/execution/execution.repo.js";
import { createCapability } from "../../src/shared/auth/auth.service.js";

const ready = {
  outcome: "ready",
  action: { kind: "transfer", network: "hedera", asset: "HBAR", amount: "2.5", recipient: "0.0.1234" },
  message: "Send 2.5 HBAR to 0.0.1234",
  review: null,
} as const;

async function withStore<T>(run: (store: ExecutionRepository) => Promise<T>): Promise<T> {
  const directory = await mkdtemp(join(tmpdir(), "9oob-store-"));
  const store = await createTestRepository(join(directory, "data"));
  try {
    return await run(store);
  } finally {
    await store.close();
    await rm(directory, { recursive: true, force: true });
  }
}

test("persists executions in Postgres and protects reads with a capability hash", async () => {
  await withStore(async store => {
    const capability = createCapability();
    const created = await store.create({
      id: capability.id,
      tokenHash: capability.tokenHash,
      intent: "Send 2.5 HBAR to 0.0.1234",
      accountId: "0.0.5678",
      evmAddress: null,
      status: "awaiting_approval",
      interpretation: ready,
    });
    assert.equal(created.status, "awaiting_approval");
    assert.equal(await store.get(capability.id, "wrong-hash"), null);
    const reopened = await store.get(capability.id, capability.tokenHash);
    assert.equal(reopened?.intent, created.intent);
    assert.deepEqual(reopened?.interpretation, ready);
  });
});

test("uses compare-and-swap so duplicate approval cannot advance twice", async () => {
  await withStore(async store => {
    const capability = createCapability();
    await store.create({
      id: capability.id,
      tokenHash: capability.tokenHash,
      intent: "Send 2.5 HBAR to 0.0.1234",
      accountId: "0.0.5678",
      evmAddress: null,
      status: "awaiting_approval",
      interpretation: ready,
    });
    const attempts = await Promise.all([
      store.transition(capability.id, capability.tokenHash, ["awaiting_approval"], { status: "approved" }),
      store.transition(capability.id, capability.tokenHash, ["awaiting_approval"], { status: "approved" }),
    ]);
    assert.equal(attempts.filter(Boolean).length, 1);
    assert.equal((await store.get(capability.id, capability.tokenHash))?.version, 1);
  });
});

test("enforces a persistent fixed-window request limit", async () => {
  await withStore(async store => {
    const start = 1_800_000_000_000;
    assert.equal(await store.consumeRateLimit("ip-hash", 2, 60, start), true);
    assert.equal(await store.consumeRateLimit("ip-hash", 2, 60, start + 1_000), true);
    assert.equal(await store.consumeRateLimit("ip-hash", 2, 60, start + 2_000), false);
    assert.equal(await store.consumeRateLimit("another-ip", 2, 60, start + 2_000), true);
    assert.equal(await store.consumeRateLimit("ip-hash", 2, 60, start + 60_000), true);
  });
});
