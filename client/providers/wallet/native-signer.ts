import type { Transaction } from "@hiero-ledger/sdk";
import type { HederaProvider } from "@hashgraph/hedera-wallet-connect";
import { transactionToBase64String } from "@hashgraph/hedera-wallet-connect";
import { WalletUnavailableError } from "@9oob/sdk";
import { hederaCaipId } from "~~/providers/wallet/hedera-identity";

export async function sendNativeTransaction(
  provider: HederaProvider | null,
  account: string | null,
  transaction: Transaction,
) {
  if (!provider || !account) throw new WalletUnavailableError("Connect a native Hedera wallet");
  const result = await provider.hedera_signAndExecuteTransaction({
    signerAccountId: hederaCaipId(account),
    transactionList: transactionToBase64String(transaction),
  });
  if (!result?.transactionId) throw new Error("No transactionId returned from wallet");
  return { transactionId: result.transactionId };
}
