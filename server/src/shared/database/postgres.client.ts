import pg from "pg";
import { logger } from "../logging/logger.js";
import { rateLimitWindow, type Database, type DocumentQuery, type StoredDocument } from "./database.types.js";

export type SqlConnection = {
  query(sql: string, parameters?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
  close(): Promise<void>;
};

export class PostgresDatabase implements Database {
  private ready?: Promise<void>;
  constructor(private readonly connection: SqlConnection) {}

  static connect(uri: string): PostgresDatabase {
    const pool = new pg.Pool({ connectionString: uri, max: 10, connectionTimeoutMillis: 10_000 });
    pool.on("error", () => logger.warn("Postgres connection is unavailable"));
    return new PostgresDatabase({ query: (sql, parameters) => pool.query(sql, parameters), close: () => pool.end() });
  }

  initialize(): Promise<void> {
    this.ready ??= this.connection
      .query(
        `
      CREATE TABLE IF NOT EXISTS noob_documents (
        collection TEXT NOT NULL,
        id TEXT NOT NULL,
        revision INTEGER NOT NULL DEFAULT 0,
        value JSONB NOT NULL,
        PRIMARY KEY (collection, id)
      );
      CREATE INDEX IF NOT EXISTS noob_documents_value_idx ON noob_documents USING GIN (value);
      CREATE TABLE IF NOT EXISTS noob_request_limits (
        bucket TEXT PRIMARY KEY,
        window_start BIGINT NOT NULL,
        request_count BIGINT NOT NULL
      );
    `,
      )
      .then(() => undefined)
      .catch(error => {
        this.ready = undefined;
        throw error;
      });
    return this.ready;
  }

  async create<T>(collection: string, id: string, value: T): Promise<void> {
    await this.initialize();
    await this.connection.query("INSERT INTO noob_documents (collection, id, value) VALUES ($1, $2, $3::jsonb)", [
      collection,
      id,
      JSON.stringify(value),
    ]);
  }

  async read<T>(collection: string, id: string): Promise<StoredDocument<T> | null> {
    await this.initialize();
    const result = await this.connection.query(
      "SELECT revision, value FROM noob_documents WHERE collection = $1 AND id = $2",
      [collection, id],
    );
    return result.rows[0] ? { revision: Number(result.rows[0].revision), value: result.rows[0].value as T } : null;
  }

  async replace<T>(collection: string, id: string, revision: number, value: T): Promise<boolean> {
    await this.initialize();
    const result = await this.connection.query(
      "UPDATE noob_documents SET value = $4::jsonb, revision = revision + 1 WHERE collection = $1 AND id = $2 AND revision = $3 RETURNING id",
      [collection, id, revision, JSON.stringify(value)],
    );
    return result.rows.length === 1;
  }

  async list<T>(collection: string, query: DocumentQuery): Promise<T[]> {
    await this.initialize();
    const result = await this.connection.query(
      "SELECT value FROM noob_documents WHERE collection = $1 AND value #>> $2::text[] = ANY($3::text[]) ORDER BY value #>> $4::text[] LIMIT $5",
      [collection, query.path, query.values, query.orderBy, query.limit],
    );
    return result.rows.map(row => row.value as T);
  }

  async consumeRateLimit(bucket: string, maximum: number, windowSeconds: number, now: number): Promise<boolean> {
    const windowStart = rateLimitWindow(bucket, maximum, windowSeconds, now);
    await this.initialize();
    const result = await this.connection.query(
      `INSERT INTO noob_request_limits (bucket, window_start, request_count) VALUES ($1, $2, 1)
       ON CONFLICT(bucket) DO UPDATE SET
         window_start = EXCLUDED.window_start,
         request_count = CASE WHEN noob_request_limits.window_start = EXCLUDED.window_start
           THEN LEAST(noob_request_limits.request_count + 1, $3) ELSE 1 END
       RETURNING request_count`,
      [bucket, windowStart, maximum + 1],
    );
    return Number(result.rows[0].request_count) <= maximum;
  }

  close(): Promise<void> {
    return this.connection.close();
  }
}
