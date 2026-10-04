import { z } from "zod";
import { ClarificationHistorySchema, InterpretationSchema } from "./intent.js";
import { IntentActionSchema } from "./action.js";

export const ExecutionStatusSchema = z.enum([
  "interpreting",
  "clarification_required",
  "unsupported",
  "awaiting_wallet",
  "awaiting_approval",
  "approved",
  "awaiting_signature",
  "submitted",
  "settling",
  "completed",
  "failed",
  "cancelled",
]);

export const ExecutionSchema = z.object({
  id: z.string(),
  intent: z.string(),
  clarifications: ClarificationHistorySchema.optional(),
  accountId: z.string().nullable(),
  evmAddress: z.string().nullable(),
  status: ExecutionStatusSchema,
  interpretation: InterpretationSchema,
  sourceTxHash: z.string().nullable(),
  destinationTxHash: z.string().nullable(),
  error: z.string().nullable(),
  stage: z.enum(["transfer", "swap", "bridge", "claim"]).nullable().optional(),
  stageNetwork: z.enum(["hedera", "base"]).nullable().optional(),
  stageAction: IntentActionSchema.nullable().optional(),
  completedSteps: z
    .array(
      z.object({
        stage: z.enum(["transfer", "swap", "bridge", "claim", "approval", "association"]),
        network: z.enum(["hedera", "base"]),
        txHash: z.string(),
        amountRaw: z.string().optional(),
      }),
    )
    .optional(),
  version: z.number().int().nonnegative(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type ExecutionStatus = z.infer<typeof ExecutionStatusSchema>;
export type Execution = z.infer<typeof ExecutionSchema>;

export const SubmissionSchema = z
  .object({
    txHash: z.string().trim().min(1).max(160),
    preparationVersion: z.number().int().nonnegative(),
  })
  .strict();

export type ExecutionState = { execution: Execution; step?: Record<string, unknown> };
export const isTerminalExecution = (execution: Execution) =>
  ["completed", "failed", "cancelled"].includes(execution.status);
