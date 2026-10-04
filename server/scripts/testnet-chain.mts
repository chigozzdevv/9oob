import { readFileSync, writeFileSync, renameSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { privateKeyToAccount } from "viem/accounts";
import { keccak256, type Hex } from "viem";
import { TESTNET, type Network } from "@9oob/schema";
import { EvmProvider } from "../src/shared/integration/evm/evm.client.js";

export const root = fileURLToPath(new URL("../../", import.meta.url));
export const wallets = JSON.parse(
  readFileSync(resolve(root, "packages/foundry/deployments/wallets.testnet.json"), "utf8"),
);
export const clients = {
  hedera: new EvmProvider("hedera", TESTNET.hedera.rpc),
  base: new EvmProvider("base", TESTNET.base.rpc),
};
export const pause = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
export const readJson = (path: string) => JSON.parse(readFileSync(resolve(root, path), "utf8"));
export function saveJson(path: string, value: unknown, privateFile = false) {
  const target = resolve(root, path);
  writeFileSync(`${target}.tmp`, `${JSON.stringify(value, null, 2)}\n`, { mode: privateFile ? 0o600 : 0o644 });
  renameSync(`${target}.tmp`, target);
}
const keys = Object.fromEntries(
  (["hedera", "base"] as const).map(network => {
    const key = readFileSync(resolve(root, `packages/foundry/.secrets/${network}.env`), "utf8").match(
      /^BRIDGE_DEPLOYER_KEY=(0x[0-9a-fA-F]{64})$/m,
    )?.[1] as Hex;
    if (!key || privateKeyToAccount(key).address !== wallets[network].address)
      throw new Error("Local deployment key does not match its public wallet");
    return [network, key];
  }),
);
export const accounts = {
  hedera: privateKeyToAccount(keys.hedera as Hex),
  base: privateKeyToAccount(keys.base as Hex),
};
export const nativeSdk = createRequire(resolve(root, "packages/sdk/package.json"))("@hiero-ledger/sdk");
export const signNative = (transaction: { sign(key: unknown): Promise<unknown> }) =>
  transaction.sign(nativeSdk.PrivateKey.fromStringECDSA((keys.hedera as string).slice(2)));
const journalFile = "packages/foundry/deployments/operations.testnet.json";
const journal = existsSync(resolve(root, journalFile))
  ? readJson(journalFile)
  : { purpose: "testnet-deployment-and-validation", transactions: [] };

export async function verify(
  network: Network,
  hash: Hex,
  expected: { from: string; to?: string; data: string; value: string },
) {
  const rpc = clients[network];
  for (let attempt = 0; attempt < 30; attempt++) {
    const receipt = await rpc.receipt(hash);
    if (receipt) {
      if (receipt.status !== "0x1") throw new Error(`Transaction reverted: ${hash}`);
      const transaction = await rpc.rpc<{ from: string; to: string | null; input: string; value: string }>(
        "eth_getTransactionByHash",
        [hash],
      );
      if (
        transaction.from.toLowerCase() !== expected.from.toLowerCase() ||
        (transaction.to?.toLowerCase() ?? null) !== (expected.to?.toLowerCase() ?? null) ||
        transaction.input.toLowerCase() !== expected.data.toLowerCase() ||
        BigInt(transaction.value) !== BigInt(expected.value)
      )
        throw new Error(`Transaction does not match the prepared operation: ${hash}`);
      if (
        network === "base" &&
        BigInt(await rpc.rpc<string>("eth_blockNumber", [])) < BigInt(receipt.blockNumber) + 1n
      ) {
        await pause(2000);
        continue;
      }
      return receipt as typeof receipt & { contractAddress?: string; gasUsed?: string; effectiveGasPrice?: string };
    }
    await pause(2000);
  }
  throw new Error(`Submission is pending; its hash is recorded and must not be rebroadcast: ${hash}`);
}

export async function send(
  id: string,
  network: Network,
  owner: Network,
  request: { from?: string; to?: string; data: string; value: string },
  maximumNative = network === "hedera" ? 5n * 10n ** 18n : 10n ** 15n,
) {
  const rpc = clients[network],
    account = accounts[owner];
  if (request.from && request.from.toLowerCase() !== account.address.toLowerCase())
    throw new Error("The prepared signer differs from the local validation account");
  const expected = { from: account.address, ...request };
  const existing = journal.transactions.find((entry: { id: string }) => entry.id === id);
  if (existing) {
    if (existing.network !== network || JSON.stringify(existing.request) !== JSON.stringify(expected))
      throw new Error(`Existing operation differs: ${id}`);
    const receipt = await verify(network, existing.hash, expected);
    existing.status = "confirmed";
    existing.receipt = receipt;
    saveJson(journalFile, journal);
    return receipt;
  }
  await rpc.rpc("eth_call", [{ ...expected, value: `0x${BigInt(request.value).toString(16)}` }, "latest"]);
  const [estimate, price, nonce, balance] = await Promise.all([
    rpc.rpc<string>("eth_estimateGas", [{ ...expected, value: `0x${BigInt(request.value).toString(16)}` }]),
    rpc.rpc<string>("eth_gasPrice", []),
    rpc.rpc<string>("eth_getTransactionCount", [account.address, "pending"]),
    rpc.rpc<string>("eth_getBalance", [account.address, "latest"]),
  ]);
  const gas = (BigInt(estimate) * 120n + 99n) / 100n,
    gasPrice = BigInt(price);
  const required = BigInt(request.value) + gas * gasPrice;
  const reserve = network === "hedera" ? 10n ** 18n : 10n ** 14n;
  if (gas > 5_000_000n || required > maximumNative || BigInt(balance) < required + reserve)
    throw new Error(`Insufficient ${TESTNET[network].name} gas budget for ${id}`);
  const serialized = await account.signTransaction({
    chainId: TESTNET[network].chainId,
    type: "legacy",
    nonce: Number(BigInt(nonce)),
    to: request.to as Hex | undefined,
    data: request.data as Hex,
    value: BigInt(request.value),
    gas,
    gasPrice,
  });
  const hash = keccak256(serialized);
  const entry = {
    id,
    network,
    owner,
    hash,
    request: expected,
    nonce: Number(BigInt(nonce)),
    gas: gas.toString(),
    gasPrice: gasPrice.toString(),
    status: "submitted",
    submittedAt: new Date().toISOString(),
  };
  journal.transactions.push(entry);
  saveJson(journalFile, journal);
  console.log(JSON.stringify({ operation: id, network, hash, status: "submitted" }));
  const returned = await rpc.rpc<string>("eth_sendRawTransaction", [serialized]);
  if (returned.toLowerCase() !== hash.toLowerCase()) throw new Error("Unexpected submission hash");
  const receipt = await verify(network, hash, expected);
  Object.assign(entry, { status: "confirmed", receipt });
  saveJson(journalFile, journal);
  console.log(JSON.stringify({ operation: id, network, hash, status: "confirmed" }));
  return receipt;
}

export function safeError(error: unknown) {
  let message = error instanceof Error ? error.message : "Testnet operation failed";
  for (const key of Object.values(keys)) message = message.replaceAll(key as string, "[redacted]");
  return message;
}
