export function Journey({ status, kind }: { status: string; kind: string }) {
  const steps =
    kind === "balance" ? ["Read", "Done"] : ["Review", "Sign", ["swap", "bridge"].includes(kind) ? "Settle" : "Done"];
  if (status === "failed") steps[steps.length - 1] = "Failed";
  if (status === "cancelled") steps[steps.length - 1] = "Cancelled";
  const current =
    status === "completed"
      ? steps.length - 1
      : ["settling", "submitted", "failed", "cancelled"].includes(status)
        ? steps.length - 1
        : status === "approved" || status === "awaiting_signature"
          ? kind === "balance"
            ? 0
            : 1
          : 0;
  return (
    <ol className="noob-journey" aria-label="Execution progress">
      {steps.map((step, index) => {
        const complete = status === "completed" || (!["failed", "cancelled"].includes(status) && index < current);
        const currentStep = index === current && status !== "completed";
        return (
          <li
            className={complete ? "is-complete" : currentStep ? "is-current" : ""}
            aria-current={currentStep ? "step" : undefined}
            key={step}
          >
            <span className="noob-dot" aria-hidden="true" />
            <span>{step}</span>
          </li>
        );
      })}
    </ol>
  );
}
