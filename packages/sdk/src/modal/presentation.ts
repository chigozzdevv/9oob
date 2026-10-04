import type { Execution, Quote } from "@9oob/schema";

type ReviewContent = { message?: string; rows: [string, string][]; notes: string[] };

const networkName = (network: string) => (network === "base" ? "Base" : "Hedera");

function quoteAmount(quote: Quote) {
  const amount = quote.amountRaw.padStart(quote.amountDecimals + 1, "0");
  const whole = (quote.amountDecimals ? amount.slice(0, -quote.amountDecimals) : amount).replace(/^0+(?=\d)/, "");
  const fraction = quote.amountDecimals ? amount.slice(-quote.amountDecimals).replace(/0+$/, "") : "";
  return `${whole}${fraction ? `.${fraction}` : ""} ${quote.amountSymbol}`;
}

export function reviewContent(execution?: Execution): ReviewContent | null {
  const review = execution?.interpretation.review;
  const action =
    execution?.status === "completed"
      ? execution.interpretation.action
      : (execution?.stageAction ?? execution?.interpretation.action);
  if (!execution || !review || !action) return null;
  if (execution.stage === "claim" && ["approved", "awaiting_signature"].includes(execution.status)) {
    return {
      rows: [
        ["Payout", `${"amount" in action ? action.amount : ""} USDC`],
        ["Network", execution.stageNetwork === "base" ? "Base Sepolia" : "Hedera testnet"],
      ],
      notes: ["Release the available bridge payout to the reviewed recipient."],
    };
  }
  if (execution.status === "completed") {
    const message =
      action.kind === "balance"
        ? `You have ${review.title} on ${networkName(action.network)}.`
        : action.kind === "transfer"
          ? `Sent ${review.title.startsWith("Send ") ? review.title.slice(5) : `${action.amount} ${action.asset}`} to ${action.recipient}.`
          : `${action.kind === "swap" ? "Swap" : "Bridge"} completed on ${networkName(action.destinationNetwork)}.`;
    return { message, rows: [], notes: [] };
  }
  if (!["awaiting_approval", "approved", "awaiting_signature"].includes(execution.status)) return null;
  if (action.kind === "balance") return null;
  const rows: [string, string][] = [];
  const notes: string[] = [];
  if (action.kind === "transfer") {
    rows.push([
      "Amount",
      review.title.startsWith("Send ") ? review.title.slice(5) : `${action.amount} ${action.asset}`,
    ]);
  } else {
    const prefix = `${action.kind === "swap" ? "Swap" : "Bridge"} ${action.amount} `;
    const symbol = review.title.startsWith(prefix)
      ? review.title.slice(prefix.length).split(action.kind === "swap" ? " for " : " to ")[0]
      : action.sourceAsset;
    rows.push(["You send", `${action.amount} ${symbol}`]);
    if (review.quote) rows.push(["You receive", `≈ ${quoteAmount(review.quote)}`]);
    rows.push(["Route", `${networkName(action.sourceNetwork)} → ${networkName(action.destinationNetwork)}`]);
  }
  for (const fact of review.facts) {
    const separator = fact.indexOf(": ");
    if (separator > 0) {
      const label = fact.slice(0, separator);
      if (label === "Quoted output" && review.quote) continue;
      rows.push([label === "Quoted output" ? "Estimated output" : label, fact.slice(separator + 2)]);
    } else if (/^(Hedera testnet|Base Sepolia)$/i.test(fact)) {
      rows.push(["Network", fact]);
    } else {
      notes.push(fact);
    }
  }
  return { rows, notes };
}

export function progressMessage(execution: Execution) {
  const action = execution.interpretation.action;
  if (!action) return "Checking progress…";
  if (execution.status === "settling" && (action.kind === "swap" || action.kind === "bridge"))
    return `Waiting for settlement on ${networkName(action.destinationNetwork)}…`;
  return `Confirming on ${networkName("sourceNetwork" in action ? action.sourceNetwork : action.network)}…`;
}
