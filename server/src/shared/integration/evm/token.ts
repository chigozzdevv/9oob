import { TESTNET_TOKENS, type Network } from "@9oob/schema";
import { erc20Abi, parseAbi, type Address } from "viem";
import type { EvmProvider, UnsignedTransaction } from "./evm.client.js";
import { encodeFunctionData } from "viem";

export const htsAbi = parseAbi(["function isAssociated() view returns (bool)", "function associate() returns (int64)"]);
export const tokenAbi = erc20Abi;
export const hederaTokenId = (asset: string) =>
  asset.toUpperCase() === "USDC"
    ? TESTNET_TOKENS.hederaUsdc
    : asset.toUpperCase() === "SAUCE"
      ? TESTNET_TOKENS.hederaSauce
      : asset;

export function tokenAddress(network: Network, asset: string): Address {
  if (network === "base") {
    if (asset.toUpperCase() !== "USDC" && asset.toLowerCase() !== TESTNET_TOKENS.baseUsdc.toLowerCase())
      throw new Error("Base Sepolia currently supports ETH and the configured test USDC");
    return TESTNET_TOKENS.baseUsdc;
  }
  const id = hederaTokenId(asset);
  if (!/^0\.0\.\d{1,10}$/.test(id)) throw new Error("Use HBAR, USDC, SAUCE or an explicit Hedera testnet token ID");
  return `0x${BigInt(id.split(".")[2]).toString(16).padStart(40, "0")}`;
}

export async function tokenApproval(
  rpc: EvmProvider,
  token: Address,
  spender: Address,
  sender: Address,
  amount: bigint,
): Promise<UnsignedTransaction | null> {
  const allowance = await rpc.read<bigint>(token, tokenAbi, "allowance", [sender, spender]);
  if (allowance >= amount) return null;
  return {
    from: sender,
    to: token,
    data: encodeFunctionData({ abi: tokenAbi, functionName: "approve", args: [spender, allowance > 0n ? 0n : amount] }),
    value: "0",
  };
}

export async function association(
  rpc: EvmProvider,
  token: Address,
  sender: Address,
): Promise<UnsignedTransaction | null> {
  if (rpc.network !== "hedera" || (await rpc.read<boolean>(token, htsAbi, "isAssociated", [], sender))) return null;
  const code = await rpc.read<bigint>(token, htsAbi, "associate", [], sender);
  if (BigInt(code) !== 22n && BigInt(code) !== 194n)
    throw new Error("The testnet token association cannot be completed by this wallet");
  return { from: sender, to: token, data: encodeFunctionData({ abi: htsAbi, functionName: "associate" }), value: "0" };
}
