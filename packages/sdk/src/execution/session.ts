import type { Execution } from "@9oob/schema";

export type ActiveRun = {
  key: number;
  intent: string;
  editedIntent: string;
  clarificationReply: string;
  pendingClarification?: string;
  resolve: (execution: Execution) => void;
  reject: (error: Error) => void;
  execution?: Execution;
  restoredId?: string;
  accessToken?: string;
  step?: Record<string, unknown>;
  pendingSubmission?: PendingSubmission;
  transactionReference: string;
  retryCreation: number;
  settled: boolean;
  error?: string;
  busy: boolean;
  editing: boolean;
  visible: boolean;
};

export const SESSION_KEY = "9oob:active-execution";

export type PendingSubmission = {
  preparationVersion: number;
  network: "hedera" | "evm";
  txHash?: string;
};

export type StoredSession = {
  id: string;
  accessToken: string;
  intent?: string;
  pendingSubmission?: PendingSubmission;
};

export function readSession(storage: Storage): StoredSession | null {
  const stored = storage.getItem(SESSION_KEY);
  if (!stored) return null;
  try {
    const value = JSON.parse(stored) as StoredSession;
    const pending = value.pendingSubmission;
    if (
      typeof value.id !== "string" ||
      !value.id ||
      typeof value.accessToken !== "string" ||
      !value.accessToken ||
      (value.intent !== undefined && typeof value.intent !== "string") ||
      (pending !== undefined &&
        (!pending ||
          !Number.isSafeInteger(pending.preparationVersion) ||
          pending.preparationVersion < 0 ||
          !["hedera", "evm"].includes(pending.network) ||
          (pending.txHash !== undefined && typeof pending.txHash !== "string")))
    ) {
      throw new Error("Invalid saved execution");
    }
    return value;
  } catch {
    storage.removeItem(SESSION_KEY);
    return null;
  }
}

export function saveSession(storage: Storage, session: StoredSession): void {
  storage.setItem(SESSION_KEY, JSON.stringify(session));
}

export function clearSession() {
  try {
    sessionStorage.removeItem(SESSION_KEY);
  } catch {}
}
