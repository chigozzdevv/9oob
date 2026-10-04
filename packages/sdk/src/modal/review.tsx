import type { Execution } from "@9oob/schema";
import { ChevronDown } from "lucide-react";
import { reviewContent } from "./presentation.js";

export function Review({ execution }: { execution?: Execution }) {
  const content = reviewContent(execution);
  if (!content) return null;
  return (
    <>
      {content.message ? <p className="noob-message">{content.message}</p> : null}
      {content.rows.length ? (
        <dl className="noob-facts">
          {content.rows.map(([label, value], index) => (
            <div className="noob-fact" key={`${label}-${index}`}>
              <dt>{label}</dt>
              <dd>
                {/^0x[a-fA-F0-9]{40}$/.test(value) ? (
                  <details className="noob-address">
                    <summary aria-label={`${label}: ${value}`}>
                      <span>{`${value.slice(0, 6)}…${value.slice(-4)}`}</span>
                      <ChevronDown size={12} aria-hidden="true" />
                    </summary>
                    <span>{value}</span>
                  </details>
                ) : (
                  value
                )}
              </dd>
            </div>
          ))}
        </dl>
      ) : null}
      {content.notes.map((note, index) => (
        <p className="noob-message" key={index}>
          {note}
        </p>
      ))}
    </>
  );
}
