import { EvmAddressSchema, type IntentAction } from "@9oob/schema";
import { encodeFunctionData, type Address } from "viem";
import { formatTokenAmount, parseTokenAmount } from "../amounts.js";
import { EvmProvider } from "../evm/evm.client.js";
import { tokenAbi, tokenAddress } from "../evm/token.js";

export class BaseProvider {
  readonly rpc: EvmProvider;
  constructor(url = process.env.NOOB_BASE_RPC_URL || "https://sepolia.base.org", request: typeof fetch = fetch) {
    this.rpc = new EvmProvider("base", url, request);
  }

  async balance(accountId: string, asset = "ETH"): Promise<{ balance: string; symbol: string }> {
    const address = EvmAddressSchema.parse(accountId) as Address;
    if (asset.toUpperCase() !== "ETH") {
      const token = tokenAddress("base", asset);
      const amount = await this.rpc.read<bigint>(token, tokenAbi, "balanceOf", [address]);
      return { balance: formatTokenAmount(amount, 6), symbol: "USDC" };
    }
    const value = await this.rpc.rpc<string>("eth_getBalance", [address, "latest"]);
    if (!/^0x[\da-f]{1,64}$/i.test(value)) throw new Error("Base returned an invalid balance");
    return { balance: formatTokenAmount(BigInt(value), 18), symbol: "ETH" };
  }

  async prepareTransfer(action: Extract<IntentAction, { kind: "transfer" }>, address: string) {
    const from = EvmAddressSchema.parse(address) as Address;
    const recipient = EvmAddressSchema.parse(action.recipient) as Address;
    if (BigInt(recipient) === 0n || recipient.toLowerCase() === from.toLowerCase())
      throw new Error("Choose a different valid recipient wallet");
    const native = action.asset.toUpperCase() === "ETH";
    const amount = parseTokenAmount(action.amount, native ? 18 : 6);
    const transaction = native
      ? { from, to: recipient, data: "0x" as const, value: amount.toString() }
      : {
          from,
          to: tokenAddress("base", action.asset),
          data: encodeFunctionData({ abi: tokenAbi, functionName: "transfer", args: [recipient, amount] }),
          value: "0",
        };
    await this.rpc.simulate(transaction);
    return { kind: "source", label: "Confirm transfer", chainKey: "base", transaction };
  }
}
