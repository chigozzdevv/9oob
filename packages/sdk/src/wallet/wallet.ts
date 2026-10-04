import type { Transaction } from "@hiero-ledger/sdk";
import type { WalletRequirement } from "@9oob/schema";
import { evmSender } from "./evm.js";

export type NoobWallet = {
  accountId: string | null;
  nativeAccountId?: string | null;
  evmAddress: string | null;
  chainId?: number;
  isConnecting?: boolean;
  connect: (requirement?: WalletRequirement) => void | Promise<unknown>;
  nativeSend: (transaction: Transaction) => Promise<{ transactionId: string }>;
  evmClient?: {
    chain: { id: number };
    sendTransaction: (transaction: { to: `0x${string}`; data: `0x${string}`; value: bigint }) => Promise<string>;
  };
  switchChain: (chainId: number) => Promise<unknown>;
};

export async function walletSender(step: Record<string, unknown>, wallet: NoobWallet): Promise<() => Promise<string>> {
  if (step.kind !== "hedera-transfer") return evmSender(step, wallet);
  const accountId = wallet.nativeAccountId ?? wallet.accountId;
  if (!accountId || !/^0\.0\.\d+$/.test(accountId)) throw new Error("Connect a Hedera wallet to sign this transfer");
  if (accountId !== String(step.accountId))
    throw new Error("Your Hedera account changed. Review the intent again before signing");
  const { buildHederaTransfer } = await import("./hedera-transfer.js");
  const transaction = buildHederaTransfer(step);
  return async () => {
    const response = await wallet.nativeSend(transaction);
    if (!response?.transactionId) throw new Error("The wallet did not return a Hedera transaction ID");
    return response.transactionId;
  };
}

export class WalletUnavailableError extends Error {
  readonly name = "WalletUnavailableError";
}
