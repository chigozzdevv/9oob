import { walletIdentityFor, walletRequirementFor, type Execution, type WalletRequirement } from "@9oob/schema";
import type { NoobWallet } from "./wallet.js";
import { chainIdFor } from "./evm.js";

export type WalletGuide = {
  requirement: WalletRequirement;
  state: "ready" | "connect" | "switch" | "loading";
  label: string;
  message: string;
  chainId: number;
};

export function walletGuide(
  execution: Execution | undefined,
  wallet: NoobWallet,
  step?: Record<string, unknown>,
): WalletGuide | null {
  const action = execution?.interpretation.action;
  if (!execution || !action) return null;
  const requirement = {
    ...walletRequirementFor(action, execution.status === "awaiting_wallet" ? wallet.accountId : execution.accountId),
    ...(execution.stageNetwork ? { network: execution.stageNetwork } : {}),
  };
  let identity = walletIdentityFor(action, wallet.accountId, wallet.evmAddress);
  const bound = walletIdentityFor(action, execution.accountId, execution.evmAddress);
  if (
    bound &&
    bound.accountId === wallet.nativeAccountId &&
    requirement.network === "hedera" &&
    requirement.kind !== "evm"
  )
    identity = bound;
  if (
    requirement.kind === "account" &&
    bound &&
    [wallet.accountId, wallet.evmAddress].some(account => account?.toLowerCase() === bound.accountId.toLowerCase())
  )
    identity = bound;
  const currentNetwork = step?.chainKey === "hedera" || step?.chainKey === "base" ? step.chainKey : requirement.network;
  const network = currentNetwork === "hedera" ? "Hedera testnet" : "Base Sepolia";
  const evm = requirement.kind === "evm";
  const chainId = evm ? chainIdFor(String(step?.chainKey ?? requirement.network)) : 0;
  const activeChainId = wallet.chainId ?? wallet.evmClient?.chain.id;
  const guide: WalletGuide = { requirement, state: "ready", label: "", message: "", chainId };
  if (wallet.isConnecting && (!identity || (evm && (!activeChainId || activeChainId === chainId))))
    return { ...guide, state: "loading", label: "Checking wallet…", message: "Getting your wallet ready…" };
  if (
    !identity ||
    (evm && (!wallet.evmAddress || (!wallet.evmClient && (!activeChainId || activeChainId === chainId))))
  ) {
    return {
      ...guide,
      state: "connect",
      label: "Connect wallet",
      message:
        requirement.kind === "account"
          ? `Connect a ${network} wallet to read its balance. No signature needed.`
          : evm
            ? `Connect a wallet for this ${action.kind} on ${network}.`
            : "Connect a Hedera wallet to send this transfer.",
    };
  }
  if (
    execution.status !== "awaiting_wallet" &&
    bound &&
    identity.accountId.toLowerCase() !== bound.accountId.toLowerCase()
  ) {
    return {
      ...guide,
      state: "connect",
      requirement:
        requirement.kind === "account" && bound.accountId.startsWith("0x")
          ? { ...requirement, kind: "evm" }
          : requirement,
      label: "Switch wallet",
      message: `Reconnect ${bound.accountId} to continue with this review.`,
    };
  }
  if (evm && activeChainId !== chainId) {
    const currentNetwork = (
      {
        1: "Ethereum mainnet",
        295: "Hedera mainnet",
        296: "Hedera testnet",
        8453: "Base mainnet",
        84532: "Base Sepolia",
      } as Record<number, string>
    )[activeChainId ?? 0];
    return {
      ...guide,
      state: "switch",
      label: `Switch to ${network}`,
      message: `${currentNetwork ? `Your wallet is on ${currentNetwork}. ` : ""}Switch to ${network} to continue.`,
    };
  }
  return guide;
}
