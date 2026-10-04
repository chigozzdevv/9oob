import type { Execution, ExecutionState } from "@9oob/schema";
import type { NoobTransport } from "../transport/http.js";

export async function prepareApprovedExecution(
  execution: Execution,
  token: string,
  api: NoobTransport,
  onApproved: (execution: Execution) => void,
): Promise<ExecutionState> {
  let ready = execution;
  if (ready.status === "awaiting_approval") {
    const response = await api<ExecutionState>(`/executions/${ready.id}/approve`, token, { method: "POST" });
    ready = response.execution;
    onApproved(ready);
  }
  return api<ExecutionState>(`/executions/${ready.id}/prepare`, token, { method: "POST" });
}
