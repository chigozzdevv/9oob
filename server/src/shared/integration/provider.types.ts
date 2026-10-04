import type { Review } from "@9oob/schema";
import type { UnsignedTransaction } from "./evm/evm.client.js";

export type RoutePreparation = {
  phase: "source" | "approval" | "association";
  label: string;
  transaction: UnsignedTransaction;
  context: Record<string, unknown>;
};
export class ReviewRequiredError extends Error {
  constructor(readonly review: Review) {
    super("The quote changed. Review the updated details before continuing");
  }
}
