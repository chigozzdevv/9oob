import assert from "node:assert/strict";
import test from "node:test";
import { decodeFunctionData, encodeFunctionResult } from "viem";
import { prepareTransfer } from "../../src/features/action/transfer.service.js";
import { readBalance, reviewBalance } from "../../src/features/action/balance.service.js";
import { EvmProvider } from "../../src/shared/integration/evm/evm.client.js";
import { tokenAbi, tokenAddress } from "../../src/shared/integration/evm/token.js";
import { HederaProvider } from "../../src/shared/integration/hedera/hedera.client.js";
import type { IntentAction, Interpretation } from "@9oob/schema";

const address = `0x${"1".repeat(40)}` as const;
const recipient = `0x${"2".repeat(40)}` as const;
const transfer: Extract<IntentAction, { kind: "transfer" }> = {
  kind: "transfer",
  network: "hedera",
  asset: "HBAR",
  amount: "1.00000001",
  recipient: "0.0.2",
};

function fixture(
  options: { unassociated?: boolean; absentRecipient?: boolean; mainnet?: boolean; returnsFalse?: boolean } = {},
) {
  const requests: string[] = [];
  const calls: Array<{ method: string; params: any[] }> = [];
  const hedera = new HederaProvider("https://mirror.example", async url => {
    const path = new URL(String(url)).pathname;
    requests.push(path);
    if (path.includes("/accounts/") && !path.endsWith("/tokens")) {
      const requested = path.split("/").at(-1)!;
      if (options.absentRecipient && requested === recipient) return new Response("", { status: 404 });
      return Response.json({
        account: requested === address ? "0.0.1" : requested === recipient ? "0.0.2" : requested,
        evm_address: requested === address || requested === "0.0.1" ? address : recipient,
        balance: { balance: "100000001" },
      });
    }
    if (path.startsWith("/api/v1/tokens/"))
      return Response.json({ token_id: "0.0.5449", decimals: "6", symbol: "USDC", type: "FUNGIBLE_COMMON" });
    return Response.json({ tokens: options.unassociated ? [] : [{ token_id: "0.0.5449", balance: "1234567" }] });
  });
  const rpc = new EvmProvider("hedera", "https://rpc.example", async (_url, init) => {
    const body = JSON.parse(String(init?.body));
    calls.push(body);
    assert(!body.method.startsWith("eth_send"));
    return Response.json({
      id: 1,
      result:
        body.method === "eth_chainId"
          ? options.mainnet
            ? "0x127"
            : "0x128"
          : body.params[0].data === "0x"
            ? "0x"
            : encodeFunctionResult({ abi: tokenAbi, functionName: "transfer", result: !options.returnsFalse }),
    });
  });
  return { hedera, rpc, requests, calls };
}

test("resolves the MetaMask address for HBAR and HTS balance reads without RPC signing or switching", async () => {
  const f = fixture();
  for (const asset of ["HBAR", "USDC"]) {
    const action: IntentAction = { kind: "balance", network: "hedera", asset };
    const interpretation: Interpretation = { outcome: "ready", action, review: null, message: "" };
    const reviewed = await reviewBalance(action, interpretation, address, f.hedera);
    assert(reviewed.review?.facts.includes("Account: 0.0.1"));
    const result = await readBalance(action, reviewed, address, f.hedera, {} as any);
    assert.equal(result.review?.title, asset === "HBAR" ? "1.00000001 HBAR" : "1.234567 USDC");
  }
  assert(f.requests.includes(`/api/v1/accounts/${address}`));
  assert.equal(f.calls.length, 0);
});

test("prepares HBAR with exact tinybar to weibars conversion and keeps native signing available", async () => {
  const f = fixture();
  const step = await prepareTransfer(transfer, address, f.hedera, f.rpc);
  assert.equal(step.kind, "source");
  assert.equal(step.chainKey, "hedera");
  assert.deepEqual(step.transaction, { from: address, to: recipient, data: "0x", value: "1000000010000000000" });
  assert.equal(f.calls[1].params[0].value, `0x${1000000010000000000n.toString(16)}`);
  const native = await prepareTransfer(transfer, "0.0.1", f.hedera, f.rpc);
  assert.equal(native.kind, "hedera-transfer");
  assert.equal(native.amount, "100000001");
  assert.equal(f.calls.length, 2);
  await assert.rejects(prepareTransfer({ ...transfer, amount: "0.000000001" }, address, f.hedera, f.rpc));
});

test("prepares the exact HTS token call and includes expected transfer effects for receipt verification", async () => {
  const f = fixture();
  const step = await prepareTransfer({ ...transfer, asset: "USDC", amount: "1.234567" }, address, f.hedera, f.rpc);
  const tx = step.transaction as { to: string; data: `0x${string}`; value: string };
  assert.equal(tx.to, tokenAddress("hedera", "USDC"));
  assert.equal(tx.value, "0");
  assert.deepEqual(decodeFunctionData({ abi: tokenAbi, data: tx.data }), {
    functionName: "transfer",
    args: [recipient, 1234567n],
  });
  assert.deepEqual(step.tokenTransfer, { token: tx.to, from: address, to: recipient, amount: "1234567" });
  await assert.rejects(
    prepareTransfer({ ...transfer, asset: "USDC" }, address, fixture({ unassociated: true }).hedera, f.rpc),
    /associated/,
  );
  await assert.rejects(
    prepareTransfer(
      { ...transfer, asset: "USDC", amount: "1" },
      address,
      f.hedera,
      fixture({ returnsFalse: true }).rpc,
    ),
    /could not be prepared/,
  );
});

test("allows a new EVM HBAR recipient, rejects self sends and mainnet RPCs, and never masks Mirror outages", async () => {
  const f = fixture({ absentRecipient: true });
  const step = await prepareTransfer({ ...transfer, recipient }, address, f.hedera, f.rpc);
  assert.equal((step.transaction as { to: string }).to, recipient);
  await assert.rejects(
    prepareTransfer({ ...transfer, recipient: address }, address, f.hedera, f.rpc),
    /different recipient/,
  );
  await assert.rejects(prepareTransfer(transfer, address, f.hedera, fixture({ mainnet: true }).rpc), /Hedera testnet/i);
  const missing = new HederaProvider("https://mirror.example", async () => new Response("", { status: 404 }));
  await assert.rejects(missing.account(address), /testnet HBAR/);
  const outage = new HederaProvider("https://mirror.example", async () => new Response("", { status: 503 }));
  await assert.rejects(prepareTransfer({ ...transfer, recipient }, address, outage, f.rpc), /503/);
});

test("a fresh MetaMask address confirms its RPC balance or missing token account without masking outages", async () => {
  const hedera = new HederaProvider("https://mirror.example", async url =>
    String(url).includes("/accounts/")
      ? new Response("", { status: 404 })
      : Response.json({ token_id: "0.0.5449", type: "FUNGIBLE_COMMON", decimals: "6", symbol: "USDC" }),
  );
  let reads = 0;
  const rpc = new EvmProvider("hedera", "https://rpc.example", async (_url, init) => {
    const { method } = JSON.parse(String(init?.body));
    assert(!method.startsWith("eth_send"));
    if (method !== "eth_chainId") reads++;
    if (method === "eth_call")
      return Response.json({
        id: 1,
        error: { message: "execution reverted: CONTRACT_REVERT_EXECUTED, INVALID_ACCOUNT_ID" },
      });
    return Response.json({
      id: 1,
      result:
        method === "eth_chainId"
          ? "0x128"
          : method === "eth_getBalance"
            ? "0x0"
            : encodeFunctionResult({ abi: tokenAbi, functionName: "balanceOf", result: 0n }),
    });
  });
  for (const asset of ["HBAR", "USDC"]) {
    const action: IntentAction = { kind: "balance", network: "hedera", asset };
    const reviewed = await reviewBalance(
      action,
      { outcome: "ready", message: "", action, review: null },
      address,
      hedera,
    );
    const result = await readBalance(action, reviewed, address, hedera, {} as any, rpc);
    assert.equal(result.review?.title, `0 ${asset}`);
    assert(result.review?.facts.includes(`Account: ${address}`));
  }
  assert.equal(reads, 2);
  const outage = new EvmProvider("hedera", "https://rpc.example", async (_url, init) =>
    Response.json(
      JSON.parse(String(init?.body)).method === "eth_chainId"
        ? { id: 1, result: "0x128" }
        : { id: 1, error: { message: "Temporary RPC outage" } },
    ),
  );
  const tokenAction: IntentAction = { kind: "balance", network: "hedera", asset: "USDC" };
  await assert.rejects(
    readBalance(
      tokenAction,
      { outcome: "ready", message: "", action: tokenAction, review: null },
      address,
      hedera,
      {} as any,
      outage,
    ),
    /RPC outage/,
  );
  const wrong = new EvmProvider("hedera", "https://rpc.example", async () => Response.json({ id: 1, result: "0x127" }));
  const action: IntentAction = { kind: "balance", network: "hedera", asset: "HBAR" };
  await assert.rejects(
    readBalance(action, { outcome: "ready", message: "", action, review: null }, address, hedera, {} as any, wrong),
    /Hedera testnet/i,
  );
});
