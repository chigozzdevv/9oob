import { useEffect, useRef } from "react";
import { Pencil, Send } from "lucide-react";
import type { NoobRuntime } from "../runtime.js";
import { plainTextIntent } from "@9oob/schema";

export function IntentField({ active, update, revise }: Pick<NoobRuntime, "active" | "update" | "revise">) {
  const editRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const textarea = editRef.current;
    if (!active?.editing || !textarea) return;
    textarea.style.height = "auto";
    textarea.style.height = `${Math.min(textarea.scrollHeight, 192)}px`;
  }, [active?.editing, active?.editedIntent]);
  if (!active) return null;
  return (
    <div className={active.editing ? "noob-intent noob-editing-intent" : "noob-bubble noob-user noob-original-intent"}>
      {active.editing ? (
        <>
          <textarea
            ref={editRef}
            value={active.editedIntent}
            onChange={event => update({ editedIntent: event.target.value })}
            aria-label="Edit intent"
            maxLength={2000}
          />
          <button
            className={`noob-send ${active.editedIntent.trim() !== active.intent.trim() ? "is-active" : ""}`}
            disabled={active.editedIntent.trim() === active.intent.trim() || active.busy}
            onClick={() => void revise()}
            aria-label="Apply edited intent"
            type="button"
          >
            <Send size={18} />
          </button>
        </>
      ) : (
        <>
          <p>{plainTextIntent(active.execution?.intent ?? active.intent)}</p>
          {!active.pendingSubmission &&
          !active.restoredId &&
          (!active.execution ||
            ["awaiting_wallet", "awaiting_approval", "approved", "clarification_required", "unsupported"].includes(
              active.execution.status,
            )) ? (
            <button
              className="noob-edit"
              onClick={() =>
                update({
                  editing: true,
                  editedIntent: plainTextIntent(active.execution?.intent ?? active.intent),
                })
              }
              aria-label="Edit intent"
              disabled={active.busy}
              type="button"
            >
              <Pencil size={16} />
            </button>
          ) : null}
        </>
      )}
    </div>
  );
}
