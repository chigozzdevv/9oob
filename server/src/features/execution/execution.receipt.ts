import { type Network } from "@9oob/schema";
import { EvmProvider, type UnsignedTransaction } from "../../shared/integration/evm/evm.client.js";
import { decodeEventLog } from "viem";
import { tokenAbi } from "../../shared/integration/evm/token.js";

export async function evmSubmissionStatus(
  chainKey: string,
  txHash: string,
  preparedStep: unknown,
): Promise<"pending" | "success" | "failed" | "mismatch"> {
  if (chainKey !== "hedera" && chainKey !== "base") throw new Error("Unsupported testnet network");
  if (!/^0x[a-fA-F0-9]{64}$/.test(txHash)) throw new Error("Invalid EVM transaction hash");
  const rpc = new EvmProvider(chainKey as Network);
  const expected = (preparedStep as { transaction?: UnsignedTransaction } | undefined)?.transaction;
  if (!expected?.from || !expected.to || !expected.data || expected.value === undefined) return "mismatch";
  const transaction = await rpc.rpc<{ from: string; to: string; input: string; value: string } | null>(
    "eth_getTransactionByHash",
    [txHash],
  );
  if (!transaction) return "pending";
  if (
    transaction.from?.toLowerCase() !== expected.from.toLowerCase() ||
    transaction.to?.toLowerCase() !== expected.to.toLowerCase() ||
    transaction.input?.toLowerCase() !== expected.data.toLowerCase() ||
    BigInt(transaction.value ?? "0x0") !== BigInt(expected.value)
  )
    return "mismatch";
  const receipt = await rpc.receipt(txHash);
  if (!receipt) return "pending";
  if (receipt.status !== "0x1") return "failed";
  const transfer = (preparedStep as { tokenTransfer?: { token: string; from: string; to: string; amount: string } })
    .tokenTransfer;
  if (
    transfer &&
    !receipt.logs.some(log => {
      if (log.address.toLowerCase() !== transfer.token.toLowerCase()) return false;
      try {
        const event = decodeEventLog({ abi: tokenAbi, eventName: "Transfer", topics: log.topics, data: log.data });
        return (
          event.args.from.toLowerCase() === transfer.from.toLowerCase() &&
          event.args.to.toLowerCase() === transfer.to.toLowerCase() &&
          event.args.value === BigInt(transfer.amount)
        );
      } catch {
        return false;
      }
    })
  )
    return "mismatch";
  if (chainKey === "base" && BigInt(await rpc.rpc<string>("eth_blockNumber", [])) < BigInt(receipt.blockNumber) + 1n)
    return "pending";
  return "success";
}
