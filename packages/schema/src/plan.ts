import { z } from "zod";
import { QuoteSchema } from "./quote.js";

export const ReviewSchema = z
  .object({
    title: z.string().trim().min(1).max(120),
    facts: z.array(z.string().trim().min(1).max(160)).max(8),
    quote: QuoteSchema.nullable(),
  })
  .strict();
export type Review = z.infer<typeof ReviewSchema>;
