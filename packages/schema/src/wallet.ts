import { z } from "zod";
import type { IntentAction } from "./action.js";

export const NetworkSchema = z.enum(["hedera", "base"]);

export const EvmAddressSchema = z.string().regex(/^0x[a-fA-F0-9]{40}$/);

export const AccountIdSchema = z.union([
  z
    .string()
    .trim()
    .regex(/^0\.0\.\d{1,10}$/),
  EvmAddressSchema,
]);
export const WalletIdentitySchema = z
  .object({ accountId: AccountIdSchema, evmAddress: EvmAddressSchema.nullable() })
  .strict();
export type Network = z.infer<typeof NetworkSchema>;

export type WalletRequirement = { kind: "account" | "native" | "evm"; network: Network };

export function walletRequirementFor(action: IntentAction, accountId: string | null = null): WalletRequirement {
  if (action.kind === "balance") return { kind: "account", network: action.network };
  if (action.kind === "transfer")
    return {
      kind: action.network === "hedera" && accountId && /^0\.0\.\d+$/.test(accountId) ? "native" : "evm",
      network: action.network,
    };
  return { kind: "evm", network: action.sourceNetwork };
}

export function walletIdentityFor(action: IntentAction, accountId: string | null, evmAddress: string | null) {
  const requirement = walletRequirementFor(action, accountId);
  const native = accountId && /^0\.0\.\d{1,10}$/.test(accountId) ? accountId : null;
  const evm = EvmAddressSchema.safeParse(evmAddress ?? accountId);
  const address = evm.success ? evm.data : null;
  const selected = requirement.kind === "evm" || requirement.network === "base" ? address : (native ?? address);
  return selected ? { accountId: selected, evmAddress: address } : null;
}
