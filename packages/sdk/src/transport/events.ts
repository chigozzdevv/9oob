import type { Execution } from "@9oob/schema";

export type NoobRequest = {
  intent: string;
  resolve: (execution: Execution) => void;
  reject: (error: Error) => void;
};

type RequestListener = (request: NoobRequest) => void;
const listeners = new Set<RequestListener>();

export function subscribeToNoobRequests(listener: RequestListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export const requestListeners = listeners;

export function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
