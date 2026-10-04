import assert from "node:assert/strict";
import test from "node:test";
import { BaseProvider } from "../../src/shared/integration/base/base.client.js";

const address = `0x${"1".repeat(40)}`;

test("reads native ETH on verified Base Sepolia with exact wei precision and no wallet transaction", async () => {
  const calls: Array<{ method: string; params: string[] }> = [];
  const base = new BaseProvider("https://rpc.example", async (_url, init) => {
    assert.equal(init?.cache, "no-store");
    const body = JSON.parse(String(init?.body));
    calls.push(body);
    return Response.json({ id: 1, result: body.method === "eth_chainId" ? "0x14a34" : "0x1bc16d674ec80001" });
  });
  assert.deepEqual(await base.balance(address), { balance: "2.000000000000000001", symbol: "ETH" });
  assert.deepEqual(
    calls.map(call => [call.method, call.params]),
    [
      ["eth_chainId", []],
      ["eth_getBalance", [address, "latest"]],
    ],
  );
});

test("rejects the wrong chain, invalid addresses and malformed RPC replies", async () => {
  let reads = 0;
  const wrongChain = new BaseProvider("https://rpc.example", async () => {
    reads++;
    return Response.json({ id: 1, result: "0x2105" });
  });
  await assert.rejects(wrongChain.balance("0.0.1"));
  assert.equal(reads, 0);
  await assert.rejects(wrongChain.balance(address), /Base Sepolia/);
  assert.equal(reads, 1);
  for (const bad of [
    { id: 1, result: "-1" },
    { id: 1, error: { message: "RPC error" } },
    { id: 9, result: "0x1" },
  ]) {
    const base = new BaseProvider("https://rpc.example", async (_url, init) =>
      Response.json(JSON.parse(String(init?.body)).method === "eth_chainId" ? { id: 1, result: "0x14a34" } : bad),
    );
    await assert.rejects(base.balance(address), /invalid balance|RPC response|RPC error/);
  }
  const zero = new BaseProvider("https://rpc.example", async (_url, init) =>
    Response.json({ id: 1, result: JSON.parse(String(init?.body)).method === "eth_chainId" ? "0x14a34" : "0x0" }),
  );
  assert.equal((await zero.balance(address)).balance, "0");
});
