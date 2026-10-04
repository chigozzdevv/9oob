import { AccountId, Hbar, TokenId, TransferTransaction } from "@hiero-ledger/sdk";

export function buildHederaTransfer(step: Record<string, unknown>) {
  if (step.network !== "testnet") throw new Error("Only Hedera testnet transfers are supported");
  const sender = AccountId.fromString(String(step.accountId));
  const receiver = AccountId.fromString(String(step.recipient));
  const amount = BigInt(String(step.amount));
  if (String(step.asset).toUpperCase() === "HBAR") {
    return new TransferTransaction()
      .addHbarTransfer(sender, Hbar.fromTinybars((-amount).toString()))
      .addHbarTransfer(receiver, Hbar.fromTinybars(amount.toString()));
  }
  const token = TokenId.fromString(String(step.asset));
  return new TransferTransaction().addTokenTransfer(token, sender, -amount).addTokenTransfer(token, receiver, amount);
}
