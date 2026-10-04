export type DatabaseMode = "mongodb" | "postgres";
export type DatabaseConfig = { mode: DatabaseMode; uri: string };
export type StoredDocument<T> = { revision: number; value: T };
export type DocumentQuery = { path: string[]; values: string[]; orderBy: string[]; limit: number };

export interface Database {
  initialize(): Promise<void>;
  create<T>(collection: string, id: string, value: T): Promise<void>;
  read<T>(collection: string, id: string): Promise<StoredDocument<T> | null>;
  replace<T>(collection: string, id: string, revision: number, value: T): Promise<boolean>;
  list<T>(collection: string, query: DocumentQuery): Promise<T[]>;
  consumeRateLimit(bucket: string, maximum: number, windowSeconds: number, now: number): Promise<boolean>;
  close(): Promise<void>;
}

export function rateLimitWindow(bucket: string, maximum: number, windowSeconds: number, now: number): number {
  if (
    !bucket ||
    !Number.isSafeInteger(maximum + 1) ||
    maximum < 1 ||
    !Number.isSafeInteger(windowSeconds) ||
    windowSeconds < 1 ||
    !Number.isFinite(now)
  )
    throw new Error("Invalid rate limit parameters");
  return Math.floor(Math.floor(now / 1000) / windowSeconds) * windowSeconds;
}
