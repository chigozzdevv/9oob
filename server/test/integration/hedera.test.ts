import assert from "node:assert/strict";
import test from "node:test";
import { HederaProvider } from "../../src/shared/integration/hedera/hedera.client.js";

test("reads the current Hedera token relationship with exact integer precision", async () => {
  const paths: string[] = [];
  const hedera = new HederaProvider("https://mirror.example/", async (url, init) => {
    assert.equal(init?.cache, "no-store");
    const path = String(url).replace("https://mirror.example", "");
    paths.push(path);
    if (path === "/api/v1/accounts/0.0.1") return Response.json({ account: "0.0.1", balance: { balance: 100 } });
    if (path === "/api/v1/tokens/0.0.5449")
      return Response.json({ token_id: "0.0.5449", symbol: "USDC", decimals: "6" });
    assert.equal(path, "/api/v1/accounts/0.0.1/tokens?token.id=0.0.5449&limit=1");
    return new Response('{"tokens":[{"token_id":"0.0.5449","balance":9007199254740993}]}');
  });
  assert.deepEqual(await hedera.balance("0.0.1", "0.0.5449"), {
    balance: "9007199254.740993",
    symbol: "USDC",
    decimals: 6,
  });
  assert.equal(paths.length, 3);
  assert.equal(
    paths.some(path => path.startsWith("/api/v1/balances")),
    false,
  );
});

test("an absent token relationship is zero and native HBAR uses the account balance", async () => {
  const hedera = new HederaProvider("https://mirror.example", async url => {
    const path = new URL(String(url)).pathname;
    if (path.endsWith("/tokens")) return Response.json({ tokens: [] });
    if (path.startsWith("/api/v1/tokens/")) return Response.json({ symbol: "USDC", decimals: "6" });
    return new Response('{"account":"0.0.1","balance":{"balance":100000001}}');
  });
  assert.equal((await hedera.balance("0.0.1", "0.0.5449")).balance, "0");
  assert.deepEqual(await hedera.balance("0.0.1", "HBAR"), { balance: "1.00000001", symbol: "HBAR", decimals: 8 });
});
