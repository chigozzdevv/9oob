import assert from "node:assert/strict";
import test from "node:test";
import { LiquidityService } from "../../src/features/liquidity/liquidity.service.js";
import { liquidityRoute } from "../../src/features/liquidity/liquidity.routes.js";
import { LayerZeroProvider } from "../../src/shared/integration/layerzero/layerzero.provider.js";
import { tokenAddress } from "../../src/shared/integration/evm/token.js";
import type { Network } from "@9oob/schema";

function fixture() {
  let reads = 0,
    wrongToken = false,
    outage = false,
    now = 1_790_000_000_000;
  const clients = Object.fromEntries(
    (["hedera", "base"] as const).map(network => [
      network,
      {
        assertContract: async () => {
          if (outage) throw new Error("RPC unavailable");
        },
        read: async (_address: string, _abi: unknown, name: string) => {
          reads++;
          if (name === "token") return wrongToken ? `0x${"9".repeat(40)}` : tokenAddress(network, "USDC");
          if (name === "paused") return network === "base";
          if (name === "reserved") return 125_000n;
          if (name === "availableLiquidity") return 9_000_000_000_000_001n;
          return 9_000_000_000_125_001n;
        },
      },
    ]),
  );
  const provider = {
    clients,
    address: (network: Network) => `0x${(network === "hedera" ? "1" : "2").repeat(40)}`,
  } as unknown as LayerZeroProvider;
  return {
    service: new LiquidityService(provider, () => now),
    reads: () => reads,
    expire: () => {
      now += 16_000;
    },
    wrong: () => {
      wrongToken = true;
    },
    offline: () => {
      outage = true;
    },
  };
}

test("pool reads preserve exact amounts, paused state and share concurrent RPC work", async () => {
  const f = fixture();
  const [a, b] = await Promise.all([f.service.read(), f.service.read()]);
  assert.deepEqual(a, b);
  assert.equal(f.reads(), 10);
  assert.equal(a.pools[0].availableUSDC, "9000000000.000001");
  assert.equal(a.pools[0].reservedUSDC, "0.125");
  assert.equal(a.pools[1].paused, true);
  assert.deepEqual(await f.service.read(), a);
  assert.equal(f.reads(), 10);
  f.expire();
  assert.notEqual((await f.service.read()).observedAt, a.observedAt);
  assert.equal(f.reads(), 20);
});

test("expired or mismatched pool data returns unavailable instead of a fabricated balance", async () => {
  const f = fixture();
  await f.service.read();
  f.expire();
  f.offline();
  const request = new Request("http://localhost/api/noob/liquidity");
  const unavailable = await liquidityRoute(request, f.service);
  assert.equal(unavailable?.status, 503);
  assert.equal(unavailable?.headers.get("Cache-Control"), "no-store");
  assert.equal("pools" in (await unavailable!.json()), false);
  const wrong = fixture();
  wrong.wrong();
  await assert.rejects(wrong.service.read(), /unexpected token/);
  assert.equal((await liquidityRoute(new Request(request.url, { method: "POST" }), wrong.service))?.status, 405);
  assert.equal(liquidityRoute(new Request("http://localhost/api/noob/executions"), f.service), null);
});
