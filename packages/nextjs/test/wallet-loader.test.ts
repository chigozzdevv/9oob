import assert from "node:assert/strict";
import test from "node:test";
import type { NoobWallet } from "@9oob/sdk";
import { createWalletLoader } from "../providers/wallet/loader.js";

function wallet(connect: NoobWallet["connect"] = () => undefined): NoobWallet {
  return {
    accountId: `0x${"1".repeat(40)}`,
    evmAddress: `0x${"1".repeat(40)}`,
    connect,
    nativeSend: async () => {
      throw new Error("No signing in this test");
    },
    switchChain: async () => undefined,
  };
}

test("preloading and an early connection share one load and wait for the mounted wallet", async () => {
  let starts = 0;
  const requirements: unknown[] = [];
  const loader = createWalletLoader(
    async () => {
      starts++;
    },
    () => assert.fail("Unexpected loading failure"),
  );
  const first = loader.load();
  assert.equal(loader.load(), first);
  const connecting = loader.wallet.connect({ kind: "evm", network: "hedera" });
  await Promise.resolve();
  assert.equal(starts, 1);
  assert.equal(requirements.length, 0);
  const ready = wallet(requirement => {
    requirements.push(requirement);
  });
  loader.publish(ready);
  assert.equal(await first, ready);
  await connecting;
  assert.deepEqual(requirements, [{ kind: "evm", network: "hedera" }]);
  let updatedConnections = 0;
  const next = wallet(() => {
    updatedConnections++;
  });
  loader.publish(next);
  await loader.wallet.connect();
  assert.equal(updatedConnections, 1);
  assert.equal(starts, 1);
  loader.dispose();
});

test("failed loading unlocks retry without replacing the execution provider", async () => {
  let starts = 0,
    errors = 0;
  const loader = createWalletLoader(
    async () => {
      if (++starts === 1) throw new Error("Chunk unavailable");
    },
    () => {
      errors++;
    },
  );
  await assert.rejects(loader.load(), /Chunk unavailable/);
  assert.equal(errors, 1);
  const retry = loader.load();
  const ready = wallet();
  loader.publish(ready);
  assert.equal(await retry, ready);
  assert.equal(starts, 2);
  loader.dispose();
});

test("loading times out retryably and ignores errors from a superseded attempt", async () => {
  let rejectFirst!: (error: Error) => void;
  let starts = 0,
    errors = 0;
  const loader = createWalletLoader(
    () => {
      starts++;
      return starts === 1
        ? new Promise((_, reject) => {
            rejectFirst = reject;
          })
        : Promise.resolve();
    },
    () => {
      errors++;
    },
    1,
  );
  const expired = assert.rejects(loader.load(), /timed out/);
  await expired;
  const retry = loader.load();
  rejectFirst(new Error("Late chunk error"));
  await Promise.resolve();
  assert.equal(errors, 1);
  const ready = wallet();
  loader.publish(ready);
  assert.equal(await retry, ready);
  loader.dispose();
});

test("unmount cancels outstanding readiness without a wallet prompt", async () => {
  const loader = createWalletLoader(
    async () => undefined,
    () => assert.fail("Unmount is not a loading error"),
  );
  const cancelled = assert.rejects(loader.load(), /cancelled/);
  loader.dispose();
  await cancelled;
});
