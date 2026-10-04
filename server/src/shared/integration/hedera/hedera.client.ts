import { parse as parseJson, parseNumberAndBigInt } from "lossless-json";
import { formatTokenAmount, parseTokenAmount } from "../amounts.js";
import { EvmAddressSchema } from "@9oob/schema";
import type { Address } from "viem";

type MirrorToken = {
  token_id: string;
  name: string;
  symbol: string;
  decimals: string;
  type: string;
  deleted?: boolean;
  pause_status?: string;
  custom_fees?: Record<string, unknown>;
};
type MirrorAccount = {
  account: string;
  balance: { balance: number | bigint | string };
  evm_address?: string | null;
  alias?: string | null;
  deleted?: boolean;
};
type MirrorTransactions = {
  transactions?: Array<{
    result?: string;
    consensus_timestamp?: string;
    transfers?: Array<{ account: string; amount: number | bigint | string }>;
    token_transfers?: Array<{ account: string; token_id: string; amount: number | bigint | string }>;
  }>;
};
type MirrorTokenRelationships = { tokens?: Array<{ token_id: string; balance?: number | bigint | string }> };

const accountIdPattern = /^0\.0\.\d{1,10}$/;
const tokenIdPattern = /^0\.0\.\d{1,10}$/;

export class HederaAccountNotFoundError extends Error {}

export class HederaProvider {
  private readonly baseUrl: string;

  constructor(
    baseUrl = process.env.HEDERA_MIRROR_TESTNET_URL || "https://testnet.mirrornode.hedera.com",
    private readonly request: typeof fetch = fetch,
  ) {
    this.baseUrl = baseUrl.replace(/\/$/, "");
  }

  async account(accountId: string): Promise<MirrorAccount> {
    if (!accountIdPattern.test(accountId) && !EvmAddressSchema.safeParse(accountId).success)
      throw new Error("Connect a Hedera testnet wallet for this action");
    const account = await this.get<MirrorAccount>(`/api/v1/accounts/${accountId}`);
    if (!accountIdPattern.test(account.account) || account.deleted)
      throw new Error("This Hedera testnet account is unavailable");
    const numericAddress = `0x${BigInt(account.account.split(".")[2]).toString(16).padStart(40, "0")}`;
    if (
      accountId.startsWith("0x") &&
      accountId.toLowerCase() !== account.evm_address?.toLowerCase() &&
      accountId.toLowerCase() !== numericAddress
    )
      throw new Error("The Hedera account does not match this wallet address");
    return account;
  }

  async token(tokenId: string): Promise<MirrorToken> {
    if (!tokenIdPattern.test(tokenId)) throw new Error("Use HBAR or a Hedera token ID such as 0.0.123");
    return this.get<MirrorToken>(`/api/v1/tokens/${tokenId}`);
  }

  async assertTokenAssociated(accountId: string, tokenId: string): Promise<void> {
    const params = new URLSearchParams({ "token.id": tokenId, limit: "1" });
    const relationships = await this.get<MirrorTokenRelationships>(`/api/v1/accounts/${accountId}/tokens?${params}`);
    if (!relationships.tokens?.some(relationship => relationship.token_id === tokenId)) {
      throw new Error(`Account ${accountId} must be associated with token ${tokenId} before it can receive it`);
    }
  }

  async balance(accountId: string, asset: string): Promise<{ balance: string; symbol: string; decimals: number }> {
    const account = await this.account(accountId);
    if (asset.toUpperCase() === "HBAR") {
      return { balance: formatTokenAmount(BigInt(account.balance.balance), 8), symbol: "HBAR", decimals: 8 };
    }
    const token = await this.token(asset);
    const params = new URLSearchParams({ "token.id": asset, limit: "1" });
    const relationships = await this.get<MirrorTokenRelationships>(`/api/v1/accounts/${accountId}/tokens?${params}`);
    const amount = relationships.tokens?.find(row => row.token_id === asset)?.balance ?? 0;
    return {
      balance: formatTokenAmount(BigInt(amount), Number(token.decimals)),
      symbol: token.symbol,
      decimals: Number(token.decimals),
    };
  }

  async transactionStatus(
    transactionId: string,
    expected: { accountId: string; asset: string; recipient: string; amount: string },
  ): Promise<"pending" | "success" | "failed" | "mismatch"> {
    if (!/^0\.0\.\d{1,10}@\d+\.\d{1,9}$/.test(transactionId)) throw new Error("Invalid Hedera transaction ID");
    const [accountId, validStart] = transactionId.split("@");
    if (accountId !== expected.accountId) return "mismatch";
    const [seconds, nanos] = validStart.split(".");
    const mirrorId = `${accountId}-${seconds}-${nanos.padEnd(9, "0")}`;
    const response = await this.request(`${this.baseUrl}/api/v1/transactions/${encodeURIComponent(mirrorId)}`, {
      cache: "no-store",
    });
    if (response.status === 404) return "pending";
    if (!response.ok) throw new Error(`Hedera Mirror Node returned ${response.status}`);
    const body = parseMirrorJson<MirrorTransactions>(await response.text());
    const transaction = body.transactions?.find(candidate => candidate.result);
    const result = transaction?.result?.toUpperCase();
    if (!transaction || !result) return "pending";
    if (result !== "SUCCESS") return "failed";
    const amount = BigInt(expected.amount);
    const sender =
      expected.asset.toUpperCase() === "HBAR"
        ? sumAmounts(
            transaction.transfers
              ?.filter(transfer => transfer.account === expected.accountId)
              .map(transfer => transfer.amount),
          )
        : sumAmounts(
            transaction.token_transfers
              ?.filter(transfer => transfer.account === expected.accountId && transfer.token_id === expected.asset)
              .map(transfer => transfer.amount),
          );
    const recipient =
      expected.asset.toUpperCase() === "HBAR"
        ? sumAmounts(
            transaction.transfers
              ?.filter(transfer => transfer.account === expected.recipient)
              .map(transfer => transfer.amount),
          )
        : sumAmounts(
            transaction.token_transfers
              ?.filter(transfer => transfer.account === expected.recipient && transfer.token_id === expected.asset)
              .map(transfer => transfer.amount),
          );
    return sender <= -amount && recipient === amount ? "success" : "mismatch";
  }

  private async get<T>(path: string): Promise<T> {
    const response = await this.request(`${this.baseUrl}${path}`, { cache: "no-store" });
    if (response.status === 404 && /^\/api\/v1\/accounts\/[^/]+$/.test(path))
      throw new HederaAccountNotFoundError(
        "No account found on Hedera testnet. Fund this wallet with testnet HBAR first.",
      );
    if (!response.ok) throw new Error(`Hedera Mirror Node returned ${response.status}`);
    return parseMirrorJson<T>(await response.text());
  }
}

function parseMirrorJson<T>(source: string): T {
  return parseJson(source, undefined, { parseNumber: parseNumberAndBigInt }) as T;
}

function sumAmounts(values: Array<number | bigint | string> | undefined): bigint {
  return (values ?? []).reduce<bigint>((sum, value) => sum + BigInt(value), 0n);
}

export const amountToSmallestUnit = parseTokenAmount;

export async function resolveHederaAccount(accountId: string, hedera: HederaProvider): Promise<string> {
  if (accountIdPattern.test(accountId)) return accountId;
  return (await hedera.account(EvmAddressSchema.parse(accountId))).account;
}

export function hederaAccountAddress(account: Pick<MirrorAccount, "account" | "evm_address">): Address {
  if (account.evm_address && EvmAddressSchema.safeParse(account.evm_address).success)
    return account.evm_address as Address;
  if (!accountIdPattern.test(account.account)) throw new Error("Invalid Hedera account");
  return `0x${BigInt(account.account.split(".")[2]).toString(16).padStart(40, "0")}`;
}
