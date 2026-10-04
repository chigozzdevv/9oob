import type { NoobWallet } from "./wallet.js";

export function chainIdFor(chainKey: string): number {
  return chainKey === "hedera" ? 296 : chainKey === "base" ? 84532 : 0;
}

export function evmSender(step: Record<string, unknown>, wallet: NoobWallet): () => Promise<string> {
  if (step.kind !== "approval" && step.kind !== "source") throw new Error("This wallet step is not supported");
  const client = wallet.evmClient;
  if (!client || !wallet.evmAddress) throw new Error("Connect an EVM wallet to sign this testnet transaction");
  const chainKey = String(step.chainKey);
  const chainId = chainIdFor(chainKey);
  if (!chainId) throw new Error("This EVM network is not supported");
  if (client.chain.id !== chainId)
    throw new Error(`Switch your wallet to ${chainKey === "hedera" ? "Hedera" : "Base"} to continue`);
  const transaction = step.transaction as { from: string; to: `0x${string}`; data: `0x${string}`; value: string };
  if (transaction.from.toLowerCase() !== wallet.evmAddress.toLowerCase())
    throw new Error("The server prepared a transaction for a different wallet");
  return () => client.sendTransaction({ to: transaction.to, data: transaction.data, value: BigInt(transaction.value) });
}
