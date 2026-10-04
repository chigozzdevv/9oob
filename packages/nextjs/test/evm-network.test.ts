import assert from "node:assert/strict";
import test from "node:test";
import { synchronizeEvmNetwork } from "../providers/wallet/evm-network.js";

test("repairs a stale network from the connected wallet without requesting a switch", async () => {
  const changes: string[] = [];
  const connector = {
    getChainId: async () => 296,
    onChainChanged: (chain: string) => {
      changes.push(chain);
    },
  };
  assert.equal(await synchronizeEvmNetwork(connector, 84532), 296);
  assert.deepEqual(changes, ["0x128"]);
  changes.length = 0;
  assert.equal(await synchronizeEvmNetwork(connector, 296), 296);
  assert.deepEqual(changes, []);
});

test("does not invent a network when the connected wallet returns invalid data or fails", async () => {
  let changes = 0;
  for (const chainId of [0, NaN, -1, 296.5])
    await assert.rejects(
      synchronizeEvmNetwork(
        {
          getChainId: async () => chainId,
          onChainChanged: () => {
            changes++;
          },
        },
        296,
      ),
      /invalid network/,
    );
  await assert.rejects(
    synchronizeEvmNetwork(
      {
        getChainId: async () => {
          throw new Error("Wallet unavailable");
        },
        onChainChanged: () => {
          changes++;
        },
      },
      296,
    ),
    /Wallet unavailable/,
  );
  assert.equal(changes, 0);
});
