import { EvmAddressSchema, TESTNET_TOKENS, type IntentAction, type Review } from "@9oob/schema";
import { decodeEventLog, encodeFunctionData, parseAbi, type Address } from "viem";
import { EvmProvider, type RpcReceipt } from "../evm/evm.client.js";
import { association, tokenAddress, tokenApproval, tokenAbi } from "../evm/token.js";
import { formatTokenAmount, parseTokenAmount } from "../amounts.js";
import { ReviewRequiredError, type RoutePreparation } from "../provider.types.js";
import { HederaProvider } from "../hedera/hedera.client.js";
import { hederaTokenId } from "../evm/token.js";

export const SAUCER_ROUTER = tokenAddress("hedera", "0.0.19264");
export const SAUCER_FACTORY = tokenAddress("hedera", "0.0.9959");
export const saucerAbi = parseAbi([
  "function getAmountsOut(uint256 amountIn, address[] path) view returns (uint256[])",
  "function factory() view returns (address)",
  "function swapExactETHForTokens(uint256 amountOutMin, address[] path, address to, uint256 deadline) payable returns (uint256[])",
  "function swapExactTokensForETH(uint256 amountIn, uint256 amountOutMin, address[] path, address to, uint256 deadline) returns (uint256[])",
  "function swapExactTokensForTokens(uint256 amountIn, uint256 amountOutMin, address[] path, address to, uint256 deadline) returns (uint256[])",
]);
const factoryAbi = parseAbi(["function getPair(address tokenA, address tokenB) view returns (address)"]);
type Swap = Extract<IntentAction, { kind: "swap" }>;

export class SaucerSwapProvider {
  constructor(
    readonly rpc = new EvmProvider("hedera"),
    private readonly hedera = new HederaProvider(),
  ) {}

  async quote(action: Swap) {
    if (action.sourceNetwork !== "hedera" || action.destinationNetwork !== "hedera")
      throw new Error("SaucerSwap swaps run on Hedera testnet");
    const nativeIn = action.sourceAsset.toUpperCase() === "HBAR";
    const nativeOut = action.destinationAsset.toUpperCase() === "HBAR";
    const whbar = tokenAddress("hedera", TESTNET_TOKENS.hederaWhbar);
    const source = nativeIn ? whbar : tokenAddress("hedera", action.sourceAsset);
    const destination = nativeOut ? whbar : tokenAddress("hedera", action.destinationAsset);
    for (const asset of [action.sourceAsset, action.destinationAsset]) {
      if (asset.toUpperCase() === "HBAR") continue;
      const metadata = await this.hedera.token(hederaTokenId(asset));
      if (
        metadata.type !== "FUNGIBLE_COMMON" ||
        metadata.deleted ||
        metadata.pause_status === "PAUSED" ||
        Object.values(metadata.custom_fees ?? {}).some(fees => Array.isArray(fees) && fees.length > 0)
      )
        throw new Error("This testnet swap requires an active fungible token without custom transfer fees");
    }
    if (source.toLowerCase() === destination.toLowerCase()) throw new Error("Choose different assets for a swap");
    await this.rpc.assertContract(SAUCER_ROUTER);
    if (
      (await this.rpc.read<Address>(SAUCER_ROUTER, saucerAbi, "factory")).toLowerCase() !== SAUCER_FACTORY.toLowerCase()
    )
      throw new Error("SaucerSwap router factory does not match the testnet deployment");
    const sourceDecimals = nativeIn ? 8 : Number(await this.rpc.read<number>(source, tokenAbi, "decimals"));
    const destinationDecimals = nativeOut ? 8 : Number(await this.rpc.read<number>(destination, tokenAbi, "decimals"));
    const pair = await this.rpc.read<Address>(SAUCER_FACTORY, factoryAbi, "getPair", [source, destination]);
    const path = BigInt(pair) !== 0n ? [source, destination] : [source, whbar, destination];
    if (new Set(path.map(value => value.toLowerCase())).size !== path.length)
      throw new Error("No liquid testnet swap route exists for these assets");
    const amount = parseTokenAmount(action.amount, sourceDecimals);
    const amounts = await this.rpc.read<bigint[]>(SAUCER_ROUTER, saucerAbi, "getAmountsOut", [amount, path]);
    const output = amounts.at(-1);
    if (!output || output <= 0n || amounts[0] !== amount || amounts.length !== path.length)
      throw new Error("SaucerSwap returned an invalid quote");
    return { source, destination, nativeIn, nativeOut, sourceDecimals, destinationDecimals, path, amount, output };
  }

  async review(action: Swap): Promise<Review> {
    if (BigInt(EvmAddressSchema.parse(action.recipient)) === 0n) throw new Error("Choose a valid recipient wallet");
    const quote = await this.quote(action);
    return {
      title: `Swap ${action.amount} ${action.sourceAsset} for ${action.destinationAsset}`,
      facts: [
        `To: ${EvmAddressSchema.parse(action.recipient)}`,
        "Hedera testnet",
        `Minimum received: ${formatTokenAmount((quote.output * 9950n) / 10000n, quote.destinationDecimals)} ${action.destinationAsset}`,
        "Slippage: 0.5%",
      ],
      quote: {
        amountRaw: quote.output.toString(),
        amountDecimals: quote.destinationDecimals,
        amountSymbol: action.destinationAsset,
      },
    };
  }

  async prepare(action: Swap, address: string, reviewed: Review | null): Promise<RoutePreparation> {
    const sender = EvmAddressSchema.parse(address) as Address;
    const recipient = EvmAddressSchema.parse(action.recipient) as Address;
    const quote = await this.quote(action);
    if (
      !reviewed?.quote ||
      reviewed.quote.amountDecimals !== quote.destinationDecimals ||
      reviewed.quote.amountSymbol !== action.destinationAsset
    )
      throw new ReviewRequiredError(await this.review(action));
    const minimum = (BigInt(reviewed.quote.amountRaw) * 9950n) / 10000n;
    if (minimum <= 0n || quote.output < minimum) throw new ReviewRequiredError(await this.review(action));
    const context = {
      provider: "saucerswap",
      sourceChainKey: "hedera",
      destinationToken: quote.destination,
      recipient,
      minimum: minimum.toString(),
      outputDecimals: quote.destinationDecimals,
    };
    if (!quote.nativeOut) {
      const associate = await association(this.rpc, quote.destination, recipient);
      if (associate) {
        if (recipient.toLowerCase() !== sender.toLowerCase())
          throw new Error("The recipient must associate the output token before this swap");
        await this.rpc.simulate(associate);
        return { phase: "association", label: `Enable ${action.destinationAsset}`, transaction: associate, context };
      }
    }
    if (!quote.nativeIn) {
      const approval = await tokenApproval(this.rpc, quote.source, SAUCER_ROUTER, sender, quote.amount);
      if (approval) {
        await this.rpc.simulate(approval);
        return { phase: "approval", label: `Approve ${action.sourceAsset}`, transaction: approval, context };
      }
    }
    const deadline = BigInt(Math.floor(Date.now() / 1000) + 300);
    const data = quote.nativeIn
      ? encodeFunctionData({
          abi: saucerAbi,
          functionName: "swapExactETHForTokens",
          args: [minimum, quote.path, recipient, deadline],
        })
      : encodeFunctionData({
          abi: saucerAbi,
          functionName: quote.nativeOut ? "swapExactTokensForETH" : "swapExactTokensForTokens",
          args: [quote.amount, minimum, quote.path, recipient, deadline],
        });
    const transaction = {
      from: sender,
      to: SAUCER_ROUTER,
      data,
      value: quote.nativeIn ? (quote.amount * 10n ** 10n).toString() : "0",
    };
    await this.rpc.simulate(transaction);
    return { phase: "source", label: "Confirm swap", transaction, context };
  }

  received(context: Record<string, unknown>, receipt: RpcReceipt): bigint {
    let amount = 0n;
    for (const log of receipt.logs) {
      if (log.address.toLowerCase() !== String(context.destinationToken).toLowerCase()) continue;
      try {
        const event = decodeEventLog({ abi: tokenAbi, data: log.data, topics: log.topics });
        if (event.eventName !== "Transfer") continue;
        const args = event.args as { from: string; to: string; value: bigint };
        if (args.to.toLowerCase() === String(context.recipient).toLowerCase()) amount += args.value;
        if (args.from.toLowerCase() === String(context.recipient).toLowerCase()) amount -= args.value;
      } catch {
        continue;
      }
    }
    if (amount < BigInt(String(context.minimum)))
      throw new Error("The swap receipt does not contain the reviewed token output");
    return amount;
  }
}
