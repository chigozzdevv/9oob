import { walletIdentityFor, type Execution, type ExecutionStatus, type Interpretation } from "@9oob/schema";

export type ExecutionCreate = {
  id: string;
  tokenHash: string;
  intent: string;
  accountId: string | null;
  evmAddress?: string | null;
  status: ExecutionStatus;
  interpretation: Interpretation;
};

export type ExecutionPatch = Partial<
  Pick<
    Execution,
    | "intent"
    | "clarifications"
    | "accountId"
    | "evmAddress"
    | "status"
    | "sourceTxHash"
    | "destinationTxHash"
    | "error"
    | "interpretation"
    | "stage"
    | "stageNetwork"
    | "stageAction"
    | "completedSteps"
  >
>;
export type ExecutionDocument = {
  tokenHash: string;
  execution: Execution;
  context: Record<string, unknown> | null;
  submissions: Record<string, string>;
};

export function executionStatus(
  interpretation: Interpretation,
  accountId: string | null,
  evmAddress: string | null = null,
): ExecutionStatus {
  if (interpretation.outcome === "clarification") return "clarification_required";
  if (interpretation.outcome === "unsupported") return "unsupported";
  if (!interpretation.action || !walletIdentityFor(interpretation.action, accountId, evmAddress))
    return "awaiting_wallet";
  return interpretation.action?.kind === "balance" ? "approved" : "awaiting_approval";
}
