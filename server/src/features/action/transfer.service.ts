import { EvmAddressSchema, type IntentAction, type Interpretation } from "@9oob/schema";
import { decodeFunctionResult, encodeFunctionData, type Address } from "viem";
import { hederaTokenId, tokenAbi, tokenAddress } from "../../shared/integration/evm/token.js";
import { EvmProvider, type UnsignedTransaction } from "../../shared/integration/evm/evm.client.js";
import {
  HederaAccountNotFoundError,
  HederaProvider,
  amountToSmallestUnit,
  hederaAccountAddress,
} from "../../shared/integration/hedera/hedera.client.js";

async function transferDetails(
  action: Extract<IntentAction, { kind: "transfer" }>,
  accountId: string,
  hedera: HederaProvider,
) {
  const [sender, recipient, token] = await Promise.all([
    hedera.account(accountId),
    hedera.account(action.recipient).catch(error => {
      if (
        error instanceof HederaAccountNotFoundError &&
        action.asset.toUpperCase() === "HBAR" &&
        EvmAddressSchema.safeParse(action.recipient).success &&
        BigInt(action.recipient) !== 0n
      )
        return { account: action.recipient, evm_address: action.recipient };
      throw error;
    }),
    action.asset.toUpperCase() === "HBAR" ? null : hedera.token(hederaTokenId(action.asset)),
  ]);
  if (
    sender.account === recipient.account ||
    (accountId.startsWith("0x") &&
      BigInt(accountId) ===
        BigInt(action.recipient.startsWith("0x") ? action.recipient : hederaAccountAddress(recipient)))
  )
    throw new Error("Choose a different recipient account");
  if (token && token.type !== "FUNGIBLE_COMMON")
    throw new Error("Only fungible HTS tokens are supported for direct transfers");
  if (token) {
    await Promise.all([
      hedera.assertTokenAssociated(sender.account, token.token_id),
      hedera.assertTokenAssociated(recipient.account, token.token_id),
    ]);
  }
  return { sender, recipient, token };
}

export async function prepareTransfer(
  action: Extract<IntentAction, { kind: "transfer" }>,
  accountId: string,
  hedera: HederaProvider,
  rpc = new EvmProvider("hedera"),
): Promise<Record<string, unknown>> {
  const { sender, recipient, token } = await transferDetails(action, accountId, hedera);
  const decimals = token ? Number(token.decimals) : 8;
  const amount = amountToSmallestUnit(action.amount, decimals);
  if (EvmAddressSchema.safeParse(accountId).success) {
    const from = accountId as Address;
    const to = recipient.evm_address
      ? (EvmAddressSchema.parse(recipient.evm_address) as Address)
      : hederaAccountAddress(recipient);
    if (BigInt(to) === 0n) throw new Error("Choose a valid recipient wallet");
    const transaction: UnsignedTransaction = token
      ? {
          from,
          to: tokenAddress("hedera", token.token_id),
          data: encodeFunctionData({ abi: tokenAbi, functionName: "transfer", args: [to, amount] }),
          value: "0",
        }
      : { from, to, data: "0x", value: (amount * 10_000_000_000n).toString() };
    const result = await rpc.simulate(transaction);
    if (token && decodeFunctionResult({ abi: tokenAbi, functionName: "transfer", data: result }) !== true)
      throw new Error("The token transfer could not be prepared");
    return {
      kind: "source",
      label: "Confirm transfer",
      chainKey: "hedera",
      transaction,
      ...(token ? { tokenTransfer: { token: transaction.to, from, to, amount: amount.toString() } } : {}),
    };
  }
  if (!/^0\.0\.\d+$/.test(recipient.account))
    throw new Error("Fund the recipient's Hedera testnet account before sending from this wallet");
  return {
    kind: "hedera-transfer",
    accountId: sender.account,
    asset: token?.token_id ?? "HBAR",
    recipient: recipient.account,
    amount: amount.toString(),
    symbol: token?.symbol ?? "HBAR",
    decimals,
    network: "testnet",
  };
}

export async function reviewTransfer(
  action: Extract<IntentAction, { kind: "transfer" }>,
  interpretation: Interpretation,
  accountId: string,
  hedera: HederaProvider,
): Promise<Interpretation> {
  if (action.asset.toUpperCase() !== "HBAR" && !/^0\.0\.\d+$/.test(hederaTokenId(action.asset))) {
    throw new Error("For an HTS transfer, include its Hedera token ID instead of a ticker");
  }
  const { sender, recipient, token } = await transferDetails(action, accountId, hedera);
  amountToSmallestUnit(action.amount, token ? Number(token.decimals) : 8);
  return {
    ...interpretation,
    review: {
      title: `Send ${action.amount} ${token?.symbol ?? "HBAR"}`,
      facts: [`To: ${recipient.account}`, `From: ${sender.account}`, "Hedera testnet"],
      quote: null,
    },
  };
}
