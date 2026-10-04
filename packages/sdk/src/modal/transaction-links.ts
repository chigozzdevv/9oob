import type { Execution, Network } from "@9oob/schema";
import type { PendingSubmission } from "../execution/session.js";
import { isValidTransactionReference } from "../execution/transaction.js";

type TransactionLink = { label: string; hash: string; href: string };
const stageNames = {
  transfer: "Transfer",
  swap: "Swap",
  bridge: "Bridge",
  claim: "Payout",
  approval: "Approval",
  association: "Enable token",
};

function explorerLink(network: Network, hash: string) {
  if (isValidTransactionReference("evm", hash))
    return network === "base"
      ? `https://sepolia.basescan.org/tx/${hash}`
      : `https://hashscan.io/testnet/transaction/${hash}`;
  if (network !== "hedera" || !isValidTransactionReference("hedera", hash)) return null;
  const [account, timestamp] = hash.split("@");
  const [seconds, nanos] = timestamp.split(".");
  return `https://hashscan.io/testnet/transaction/${account}-${seconds}-${nanos.padStart(9, "0")}`;
}

export function transactionLinks(execution?: Execution, pending?: PendingSubmission): TransactionLink[] {
  if (!execution || execution.interpretation.action?.kind === "balance") return [];
  const links: TransactionLink[] = [];
  const seen = new Set<string>();
  const add = (
    network: Network | null | undefined,
    hash: string | null | undefined,
    stage?: keyof typeof stageNames,
  ) => {
    if ((network !== "hedera" && network !== "base") || !hash) return;
    const href = explorerLink(network, hash);
    const key = `${network}:${hash.toLowerCase()}`;
    if (!href || seen.has(key)) return;
    seen.add(key);
    const name = network === "hedera" ? "Hedera" : "Base";
    links.push({ hash, href, label: stage ? `${stageNames[stage]} · ${name}` : name });
  };
  for (const step of execution.completedSteps ?? []) add(step.network, step.txHash, step.stage);
  const action = execution.stageAction ?? execution.interpretation.action;
  const sourceNetwork =
    execution.stageNetwork ??
    (action ? ("sourceNetwork" in action ? action.sourceNetwork : action.network) : undefined);
  add(sourceNetwork, execution.sourceTxHash, execution.stage === "claim" ? "claim" : undefined);
  add(pending?.network === "hedera" ? "hedera" : sourceNetwork, pending?.txHash);
  const original = execution.interpretation.action;
  add(
    original && "destinationNetwork" in original ? original.destinationNetwork : undefined,
    execution.destinationTxHash,
    "claim",
  );
  if (links.length === 1) links[0].label = links[0].label.endsWith("Hedera") ? "Hedera" : "Base";
  return links;
}
