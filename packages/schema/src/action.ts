import { z } from "zod";
import { AccountIdSchema, NetworkSchema } from "./wallet.js";

export const IntentActionSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("balance"),
      network: NetworkSchema,
      asset: z.string().trim().min(1).max(32),
    })
    .strict(),
  z
    .object({
      kind: z.literal("transfer"),
      network: NetworkSchema,
      asset: z.string().trim().min(1).max(32),
      amount: z.string().regex(/^\d+(\.\d{1,18})?$/),
      recipient: z.string().regex(/^(0\.0\.\d{1,10}|0x[a-fA-F0-9]{40})$/),
    })
    .strict(),
  z
    .object({
      kind: z.literal("bridge"),
      sourceNetwork: NetworkSchema,
      destinationNetwork: NetworkSchema,
      sourceAsset: z.string().trim().min(1).max(32),
      destinationAsset: z.string().trim().min(1).max(32),
      amount: z.string().regex(/^\d+(\.\d{1,18})?$/),
      recipient: z.string().min(1).max(128),
    })
    .strict(),
  z
    .object({
      kind: z.literal("swap"),
      sourceNetwork: NetworkSchema,
      destinationNetwork: NetworkSchema,
      sourceAsset: z.string().trim().min(1).max(32),
      destinationAsset: z.string().trim().min(1).max(32),
      amount: z.string().regex(/^\d+(\.\d{1,18})?$/),
      recipient: z.union([z.literal("self"), AccountIdSchema]),
    })
    .strict(),
]);

export type IntentAction = z.infer<typeof IntentActionSchema>;
