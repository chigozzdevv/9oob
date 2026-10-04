import { walletIdentityFor, type Interpretation } from "@9oob/schema";
import { ActionRegistry } from "../action/index.js";
import type { HederaProvider } from "../../shared/integration/hedera/hedera.client.js";
import type { TestnetProvider } from "../../shared/integration/testnet.provider.js";

export class PlanService {
  private readonly actions: ActionRegistry;
  constructor(hedera: HederaProvider, routes: TestnetProvider) {
    this.actions = new ActionRegistry(hedera, routes);
  }

  async review(
    interpretation: Interpretation,
    accountId: string | null,
    evmAddress: string | null,
  ): Promise<Interpretation> {
    if (interpretation.outcome !== "ready" || !interpretation.action) return interpretation;
    try {
      this.actions.validate(interpretation.action);
      const identity = walletIdentityFor(interpretation.action, accountId, evmAddress);
      if (!identity) return { ...interpretation, review: null };
      return await this.actions.review(interpretation, identity.accountId, identity.evmAddress);
    } catch (error) {
      return {
        outcome: "unsupported",
        action: null,
        review: null,
        message: (error instanceof Error ? error.message : "The requested route could not be verified").slice(0, 240),
      };
    }
  }
}
