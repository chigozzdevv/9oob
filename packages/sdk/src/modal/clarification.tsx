import { ArrowUp, LoaderCircle } from "lucide-react";
import type { NoobRuntime } from "../runtime.js";

export function Clarification({ active, update, clarify }: Pick<NoobRuntime, "active" | "update" | "clarify">) {
  if (!active || active.editing || active.execution?.status !== "clarification_required") return null;
  return (
    <form
      className="noob-clarification"
      onSubmit={event => {
        event.preventDefault();
        void clarify();
      }}
    >
      <div className="noob-intent">
        <textarea
          id="noob-reply"
          value={active.pendingClarification ? "" : active.clarificationReply}
          onChange={event => update({ clarificationReply: event.target.value })}
          placeholder="Reply to 9oob…"
          aria-label="Reply to 9oob"
          rows={2}
          maxLength={2000}
          disabled={active.busy}
          autoFocus
        />
        <button
          className="noob-send is-active"
          aria-label="Send details"
          disabled={active.busy || !active.clarificationReply.trim()}
          type="submit"
        >
          {active.busy ? <LoaderCircle className="noob-spin" size={18} /> : <ArrowUp size={18} />}
        </button>
      </div>
    </form>
  );
}
