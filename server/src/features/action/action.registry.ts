import type { Interpretation, IntentAction } from "@9oob/schema";
import { hederaAccountAddress, type HederaProvider } from "../../shared/integration/hedera/hedera.client.js";
import { TestnetProvider } from "../../shared/integration/testnet.provider.js";
import { tokenAddress } from "../../shared/integration/evm/token.js";
import { AccountIdSchema, EvmAddressSchema } from "@9oob/schema";
import { parseTokenAmount } from "../../shared/integration/amounts.js";
import { reviewBalance } from "./balance.service.js";
import { reviewTransfer } from "./transfer.service.js";

export class ActionRegistry {
  constructor(
    private readonly hedera: HederaProvider,
    private readonly routes: TestnetProvider,
  ) {}

  validate(action: IntentAction): void {
    if ((action.kind === "balance" || action.kind === "transfer") && action.network === "base") {
      if (action.asset.toUpperCase() !== "ETH") tokenAddress("base", action.asset);
      if (action.kind === "transfer") {
        EvmAddressSchema.parse(action.recipient);
        parseTokenAmount(action.amount, action.asset.toUpperCase() === "ETH" ? 18 : 6);
      }
      return;
    }
    if (
      (action.kind === "balance" || action.kind === "transfer") &&
      action.asset.toUpperCase() !== "HBAR" &&
      !/^0\.0\.\d+$/.test(action.asset) &&
      !["USDC", "SAUCE"].includes(action.asset.toUpperCase())
    )
      throw new Error("Include the Hedera token ID for this asset");
    if (
      action.kind === "transfer" &&
      !/^0\.0\.\d{1,10}$/.test(action.recipient) &&
      !EvmAddressSchema.safeParse(action.recipient).success
    )
      throw new Error("Use a Hedera account ID or EVM address for the recipient");
    if (action.kind === "swap" || action.kind === "bridge") {
      if (action.kind === "swap" && action.recipient !== "self") {
        if (action.destinationNetwork === "hedera") AccountIdSchema.parse(action.recipient);
        else EvmAddressSchema.parse(action.recipient);
      }
      new TestnetProvider().validate(action);
    }
  }

  async review(interpretation: Interpretation, accountId: string, evmAddress: string | null): Promise<Interpretation> {
    const action = interpretation.action;
    if (!action) return interpretation;
    switch (action.kind) {
      case "balance":
        return reviewBalance(action, interpretation, accountId, this.hedera);
      case "transfer":
        if (action.network === "base")
          return {
            ...interpretation,
            review: {
              title: `Send ${action.amount} ${action.asset}`,
              facts: [`To: ${action.recipient}`, `From: ${EvmAddressSchema.parse(accountId)}`, "Base Sepolia"],
              quote: null,
            },
          };
        return reviewTransfer(action, interpretation, accountId, this.hedera);
      case "bridge":
      case "swap": {
        const sender = EvmAddressSchema.parse(evmAddress ?? accountId);
        const resolved =
          action.kind === "swap"
            ? {
                ...action,
                recipient:
                  action.recipient === "self"
                    ? sender
                    : action.recipient.startsWith("0.0.")
                      ? hederaAccountAddress(await this.hedera.account(action.recipient))
                      : action.recipient,
              }
            : action;
        return { ...interpretation, action: resolved, review: await this.routes.review(resolved, sender) };
      }
    }
  }
}
