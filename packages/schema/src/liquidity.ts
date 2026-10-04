import { z } from "zod";
import { EvmAddressSchema, NetworkSchema } from "./wallet.js";

const tokenBalance = z.string().regex(/^\d+(\.\d{1,6})?$/);

export const LiquiditySnapshotSchema = z.object({
  observedAt: z.string().datetime(),
  pools: z
    .array(
      z.object({
        network: NetworkSchema,
        bridgeAddress: EvmAddressSchema,
        tokenAddress: EvmAddressSchema,
        totalUSDC: tokenBalance,
        availableUSDC: tokenBalance,
        reservedUSDC: tokenBalance,
        paused: z.boolean(),
      }),
    )
    .length(2)
    .refine(pools => new Set(pools.map(pool => pool.network)).size === 2),
});

export type LiquiditySnapshot = z.infer<typeof LiquiditySnapshotSchema>;
