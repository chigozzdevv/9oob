import { z } from "zod";
import { IntentActionSchema } from "./action.js";
import { ReviewSchema } from "./plan.js";
import { AccountIdSchema, EvmAddressSchema } from "./wallet.js";
import { IntentTextSchema } from "./text.js";

export const InterpretationSchema = z
  .object({
    outcome: z.enum(["ready", "clarification", "unsupported"]),
    action: IntentActionSchema.nullable(),
    message: z.string().trim().max(240),
    review: ReviewSchema.nullable(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.outcome === "ready" && !value.action) {
      ctx.addIssue({ code: "custom", message: "A ready intent must include an action", path: ["action"] });
    }
    if (value.outcome !== "ready" && value.action) {
      ctx.addIssue({ code: "custom", message: "Only ready intents can include an action", path: ["action"] });
    }
    if (value.outcome !== "ready" && value.review) {
      ctx.addIssue({ code: "custom", message: "Only ready intents can include a review", path: ["review"] });
    }
  });

export const CreateExecutionSchema = z
  .object({
    intent: IntentTextSchema,
    accountId: AccountIdSchema.nullable().default(null),
    evmAddress: EvmAddressSchema.nullable().default(null),
  })
  .strict();

export type Interpretation = z.infer<typeof InterpretationSchema>;
export type CreateExecution = z.infer<typeof CreateExecutionSchema>;

export const ClarificationTurnSchema = z.object({ question: z.string().max(240), answer: IntentTextSchema }).strict();
export const ClarificationHistorySchema = z.array(ClarificationTurnSchema).max(8);
export const ClarificationAnswerSchema = z
  .object({ answer: IntentTextSchema, version: z.number().int().nonnegative() })
  .strict();
export type ClarificationTurn = z.infer<typeof ClarificationTurnSchema>;
