import { z } from "zod";

export const QuoteSchema = z
  .object({
    amountRaw: z.string().regex(/^\d+$/),
    amountDecimals: z.number().int().min(0).max(36),
    amountSymbol: z.string().trim().min(1).max(32),
  })
  .strict();
export type Quote = z.infer<typeof QuoteSchema>;
