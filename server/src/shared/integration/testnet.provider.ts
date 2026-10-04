import { TESTNET_TOKENS, type IntentAction, type Review } from "@9oob/schema";
import { SaucerSwapProvider } from "./saucerswap/saucerswap.provider.js";
import { LayerZeroProvider } from "./layerzero/layerzero.provider.js";
import type { RoutePreparation } from "./provider.types.js";
import { formatTokenAmount } from "./amounts.js";
export { ReviewRequiredError, type RoutePreparation } from "./provider.types.js";

type Route = Extract<IntentAction, { kind: "swap" | "bridge" }>;
type Stage = Route;

export class TestnetProvider {
  constructor(
    readonly saucer = new SaucerSwapProvider(),
    readonly layerzero = new LayerZeroProvider(),
  ) {}

  validate(action: Route): void {
    const usdc = (network: string, asset: string) =>
      asset.toUpperCase() === "USDC" ||
      asset.toLowerCase() ===
        (network === "hedera" ? TESTNET_TOKENS.hederaUsdc : TESTNET_TOKENS.baseUsdc).toLowerCase();
    if (action.kind === "bridge") {
      if (
        action.sourceNetwork === action.destinationNetwork ||
        !usdc(action.sourceNetwork, action.sourceAsset) ||
        !usdc(action.destinationNetwork, action.destinationAsset)
      )
        throw new Error("The testnet bridge supports only the configured USDC tokens between Hedera and Base Sepolia");
    } else if (action.sourceNetwork === "base" && action.destinationNetwork === "base")
      throw new Error("Swaps within Base Sepolia need a configured DEX integration");
    else if (
      action.sourceNetwork !== action.destinationNetwork &&
      !(action.sourceNetwork === "hedera" ? usdc("base", action.destinationAsset) : usdc("base", action.sourceAsset))
    )
      throw new Error("The Base Sepolia side of a cross-chain swap must use the configured test USDC");
  }

  private stages(action: Route, sender: string): Stage[] {
    this.validate(action);
    if (action.kind === "bridge" || action.sourceNetwork === action.destinationNetwork) return [action];
    if (action.sourceAsset.toUpperCase() === "USDC" && action.destinationAsset.toUpperCase() === "USDC")
      return [{ ...action, kind: "bridge" }];
    const bridge: Stage = {
      ...action,
      kind: "bridge",
      sourceAsset: "USDC",
      destinationAsset: "USDC",
      recipient: action.sourceNetwork === "base" ? sender : action.recipient,
    };
    const swap: Stage = {
      ...action,
      sourceNetwork: "hedera",
      destinationNetwork: "hedera",
      sourceAsset: action.sourceNetwork === "base" ? "USDC" : action.sourceAsset,
      destinationAsset: action.sourceNetwork === "base" ? action.destinationAsset : "USDC",
      recipient: action.sourceNetwork === "base" ? action.recipient : sender,
    };
    return action.sourceNetwork === "hedera" ? [swap, bridge] : [bridge, swap];
  }

  async review(action: Route, sender: string): Promise<Review> {
    const stages = this.stages(action, sender);
    const first = stages[0];
    const firstReview = first.kind === "swap" ? await this.saucer.review(first) : await this.layerzero.review(first);
    if (stages.length === 1) return firstReview;
    const second = {
      ...stages[1],
      amount: formatTokenAmount(BigInt(firstReview.quote!.amountRaw), firstReview.quote!.amountDecimals),
    };
    const secondReview =
      second.kind === "swap" ? await this.saucer.review(second) : await this.layerzero.review(second);
    return {
      title: `Swap ${action.amount} ${action.sourceAsset} for ${action.destinationAsset}`,
      facts: [
        `To: ${action.recipient}`,
        "Steps: Swap and bridge with separate wallet confirmations",
        ...[...firstReview.facts, ...secondReview.facts].filter(
          fact => fact.startsWith("Network fee:") || fact.startsWith("Minimum received:"),
        ),
      ],
      quote: secondReview.quote,
    };
  }

  async prepare(
    action: Route,
    sender: string,
    review: Review | null,
    previous?: Record<string, unknown> | null,
  ): Promise<RoutePreparation> {
    if (previous?.claimPending) return this.layerzero.prepareClaim(previous);
    const stages = (previous?.routeStages as Stage[] | undefined) ?? this.stages(action, sender);
    const index = Number(previous?.stageIndex ?? 0);
    const stage = stages[index];
    if (!stage) throw new Error("The execution has no remaining route stage");
    const stageReview = (previous?.stageReview as Review | undefined) ?? review;
    const prepared =
      stage.kind === "swap"
        ? await this.saucer.prepare(stage, sender, stageReview)
        : await this.layerzero.prepare(stage, sender, stageReview);
    return {
      ...prepared,
      context: { ...prepared.context, routeStages: stages, stageIndex: index, stage: stage.kind, stageReview },
    };
  }

  async next(context: Record<string, unknown>, received: bigint | undefined, sender: string) {
    const stages = context.routeStages as Stage[];
    const index = Number(context.stageIndex) + 1;
    if (!stages?.[index]) return null;
    const amount = received ?? BigInt(String(context.amountRaw));
    const next = { ...stages[index], amount: formatTokenAmount(amount, 6) };
    const review = next.kind === "swap" ? await this.saucer.review(next) : await this.layerzero.review(next);
    return {
      review,
      context: {
        routeStages: stages.map((stage, i) => (i === index ? next : stage)),
        stageIndex: index,
        stage: next.kind,
        sourceChainKey: next.sourceNetwork,
        stageReview: review,
        sourceAddress: sender,
      },
    };
  }

  status(context: Record<string, unknown>, hash: string) {
    return this.layerzero.status(context, String(context.bridgeSourceHash ?? hash));
  }
}
