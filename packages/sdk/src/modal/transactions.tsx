import { ArrowUpRight } from "lucide-react";
import type { Execution } from "@9oob/schema";
import type { PendingSubmission } from "../execution/session.js";
import { transactionLinks } from "./transaction-links.js";

export function Transactions({ execution, pending }: { execution?: Execution; pending?: PendingSubmission }) {
  const links = transactionLinks(execution, pending);
  if (!links.length) return null;
  return (
    <dl className="noob-transactions" aria-label="Transactions">
      {links.map(link => (
        <div className="noob-transaction" key={link.href}>
          <dt>{link.label}</dt>
          <dd>
            <a
              href={link.href}
              target="_blank"
              rel="noopener noreferrer"
              title={link.hash}
              aria-label={`View ${link.label} transaction ${link.hash} in explorer (opens in a new tab)`}
            >
              <span>{`${link.hash.slice(0, 8)}…${link.hash.slice(-6)}`}</span>
              <ArrowUpRight size={14} aria-hidden="true" />
            </a>
          </dd>
        </div>
      ))}
    </dl>
  );
}
