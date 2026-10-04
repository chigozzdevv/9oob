import { LoaderCircle } from "lucide-react";

export function Loading({ label, ariaLabel }: { label?: string; ariaLabel?: string }) {
  return (
    <div className="noob-loading" role="status" aria-label={ariaLabel ?? label ?? "Loading"}>
      <LoaderCircle className="noob-spin" size={18} />
      {label ? <span>{label}</span> : null}
    </div>
  );
}
