import { decodeFunctionResult, encodeFunctionData, type Abi, type Address, type Hex } from "viem";
import { TESTNET, type Network } from "@9oob/schema";

export type UnsignedTransaction = { from: Address; to: Address; data: Hex; value: string };
export type RpcLog = { address: string; data: Hex; topics: [Hex, ...Hex[]]; transactionHash?: string };
export type RpcReceipt = { status: string; blockNumber: Hex; transactionHash: string; logs: RpcLog[] };

export class EvmProvider {
  constructor(
    readonly network: Network,
    private readonly url = network === "hedera"
      ? process.env.NOOB_HEDERA_EVM_RPC_URL || TESTNET.hedera.rpc
      : process.env.NOOB_BASE_RPC_URL || TESTNET.base.rpc,
    private readonly request: typeof fetch = fetch,
  ) {}

  async rpc<T>(method: string, params: unknown[]): Promise<T> {
    const chain = await this.raw<string>("eth_chainId", []);
    if (!/^0x[\da-f]+$/i.test(chain) || BigInt(chain) !== BigInt(TESTNET[this.network].chainId))
      throw new Error(`RPC must use ${TESTNET[this.network].name}`);
    return this.raw<T>(method, params);
  }

  async read<T>(address: Address, abi: Abi, name: string, args: readonly unknown[] = [], from?: Address): Promise<T> {
    const data = encodeFunctionData({ abi, functionName: name, args });
    const result = await this.rpc<Hex>("eth_call", [{ to: address, data, ...(from ? { from } : {}) }, "latest"]);
    return decodeFunctionResult({ abi, functionName: name, data: result }) as T;
  }

  async assertContract(address: Address): Promise<void> {
    const code = await this.rpc<Hex>("eth_getCode", [address, "latest"]);
    if (!/^0x[\da-f]+$/i.test(code) || /^0x0*$/i.test(code)) throw new Error(`No contract deployed at ${address}`);
  }

  async simulate(transaction: UnsignedTransaction): Promise<Hex> {
    return this.rpc<Hex>("eth_call", [
      { ...transaction, value: `0x${BigInt(transaction.value).toString(16)}` },
      "latest",
    ]);
  }

  async receipt(hash: string): Promise<RpcReceipt | null> {
    if (!/^0x[\da-f]{64}$/i.test(hash)) throw new Error("Invalid EVM transaction hash");
    return this.rpc("eth_getTransactionReceipt", [hash]);
  }

  private async raw<T>(method: string, params: unknown[]): Promise<T> {
    const response = await this.request(this.url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) throw new Error(`${TESTNET[this.network].name} RPC returned ${response.status}`);
    const data = (await response.json()) as { id?: number; result?: T; error?: { message?: string } };
    if (data.id !== 1 || data.error || !("result" in data))
      throw new Error(data.error?.message || "Invalid network RPC response");
    return data.result as T;
  }
}
