import { plainTextIntent } from "@9oob/schema";
import { useEffect, useRef, type ReactNode } from "react";
import type { NoobRuntime } from "../runtime.js";
import { IntentField } from "./intent-field.js";
import { Loading } from "./loading.js";

export function AssistantMessage({ children }: { children: ReactNode }) {
  return <div className="noob-bubble noob-assistant">{children}</div>;
}

export function Conversation({
  active,
  update,
  revise,
  children,
}: Pick<NoobRuntime, "active" | "update" | "revise"> & { children: ReactNode }) {
  const end = useRef<HTMLDivElement>(null);
  const following = useRef(true);
  useEffect(() => {
    if (following.current) end.current?.scrollIntoView({ block: "end", behavior: "auto" });
  }, [active?.execution?.version, active?.busy, active?.editing]);
  if (!active) return null;
  return (
    <div
      className="noob-conversation"
      role="log"
      aria-label="Intent conversation"
      aria-live="polite"
      aria-relevant="additions text"
      onScroll={event => {
        const node = event.currentTarget;
        following.current = node.scrollHeight - node.scrollTop - node.clientHeight < 64;
      }}
    >
      <IntentField active={active} update={update} revise={revise} />
      {active.execution?.clarifications?.map((turn, index) => (
        <div className="noob-turn" key={index}>
          <AssistantMessage>
            <p className="noob-message">{turn.question}</p>
          </AssistantMessage>
          <div className="noob-bubble noob-user">
            <p>{plainTextIntent(turn.answer)}</p>
          </div>
        </div>
      ))}
      {active.execution?.completedSteps
        ?.filter(step => ["swap", "bridge", "transfer"].includes(step.stage))
        .map((step, index) => (
          <AssistantMessage key={`completed-${index}`}>
            <p className="noob-message">
              {step.stage === "swap" ? "Swap" : step.stage === "bridge" ? "Bridge" : "Transfer"} confirmed on{" "}
              {step.network === "hedera" ? "Hedera testnet" : "Base Sepolia"}.
            </p>
          </AssistantMessage>
        ))}
      {children}
      {active.pendingClarification ? (
        <>
          <div className="noob-bubble noob-user">
            <p>{active.pendingClarification}</p>
          </div>
          <AssistantMessage>
            <Loading ariaLabel="Loading reply" />
          </AssistantMessage>
        </>
      ) : null}
      <div ref={end} className="noob-conversation-end" />
    </div>
  );
}
