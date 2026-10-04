import { EvmAddressSchema, type Interpretation, type IntentAction } from "@9oob/schema";
import {
  HederaAccountNotFoundError,
  HederaProvider,
  resolveHederaAccount,
} from "../../shared/integration/hedera/hedera.client.js";
import type { BaseProvider } from "../../shared/integration/base/base.client.js";
import { hederaTokenId, tokenAbi, tokenAddress } from "../../shared/integration/evm/token.js";
import { EvmProvider } from "../../shared/integration/evm/evm.client.js";
import { formatTokenAmount } from "../../shared/integration/amounts.js";
import type { Address } from "viem";

async function balanceAccount(accountId: string, hedera: HederaProvider): Promise<string> {
  try {
    return await resolveHederaAccount(accountId, hedera);
  } catch (error) {
    if (error instanceof HederaAccountNotFoundError && EvmAddressSchema.safeParse(accountId).success) return accountId;
    throw error;
  }
}

async function unmappedBalance(account: string, asset: string, hedera: HederaProvider, rpc: EvmProvider) {
  const address = EvmAddressSchema.parse(account) as Address;
  if (asset.toUpperCase() === "HBAR") {
    const amount = await rpc.rpc<string>("eth_getBalance", [address, "latest"]);
    if (!/^0x[\da-f]{1,64}$/i.test(amount)) throw new Error("Hedera returned an invalid balance");
    return { balance: formatTokenAmount(BigInt(amount), 18), symbol: "HBAR" };
  }
  const token = await hedera.token(hederaTokenId(asset));
  if (token.type !== "FUNGIBLE_COMMON") throw new Error("Only HBAR and fungible HTS balances are supported");
  let amount: bigint;
  try {
    amount = await rpc.read<bigint>(tokenAddress("hedera", token.token_id), tokenAbi, "balanceOf", [address]);
  } catch (error) {
    if (error instanceof Error && /\bINVALID_ACCOUNT_ID\b/.test(error.message)) amount = 0n;
    else throw error;
  }
  return { balance: formatTokenAmount(amount, Number(token.decimals)), symbol: token.symbol };
}

export async function reviewBalance(
  action: Extract<IntentAction, { kind: "balance" }>,
  interpretation: Interpretation,
  accountId: string,
  hedera: HederaProvider,
): Promise<Interpretation> {
  if (action.network === "base") {
    return {
      ...interpretation,
      review: {
        title: `${action.asset} balance`,
        facts: [`Account: ${EvmAddressSchema.parse(accountId)}`, "Base Sepolia"],
        quote: null,
      },
    };
  }
  const sourceId = await balanceAccount(accountId, hedera);
  const account = sourceId.startsWith("0x") ? sourceId : (await hedera.account(sourceId)).account;
  const token = action.asset.toUpperCase() === "HBAR" ? null : await hedera.token(hederaTokenId(action.asset));
  if (token && token.type !== "FUNGIBLE_COMMON") throw new Error("Only HBAR and fungible HTS balances are supported");
  return {
    ...interpretation,
    review: {
      title: `${token?.symbol ?? "HBAR"} balance`,
      facts: [`Account: ${account}`, "Hedera testnet"],
      quote: null,
    },
  };
}

export async function readBalance(
  action: Extract<IntentAction, { kind: "balance" }>,
  interpretation: Interpretation,
  accountId: string,
  hedera: HederaProvider,
  base: BaseProvider,
  hederaRpc = new EvmProvider("hedera"),
): Promise<Interpretation> {
  const account =
    action.network === "base" ? EvmAddressSchema.parse(accountId) : await balanceAccount(accountId, hedera);
  const balance =
    action.network === "base"
      ? await base.balance(account, action.asset)
      : account.startsWith("0x")
        ? await unmappedBalance(account, action.asset, hedera, hederaRpc)
        : await hedera.balance(account, hederaTokenId(action.asset));
  return {
    ...interpretation,
    review: {
      title: `${balance.balance} ${balance.symbol}`,
      facts: [`Account: ${account}`, action.network === "base" ? "Base Sepolia" : "Hedera testnet"],
      quote: null,
    },
  };
}
