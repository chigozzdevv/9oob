import { type Execution, ExecutionSchema, type ExecutionStatus } from "@9oob/schema";
import { openDatabase } from "../../shared/database/database.client.js";
import type { Database, DatabaseConfig, StoredDocument } from "../../shared/database/database.types.js";
import type { ExecutionCreate, ExecutionDocument, ExecutionPatch } from "./execution.model.js";

const collection = "executions";

export class ExecutionRepository {
  constructor(private readonly database: Database) {}

  static fromConfig(config: DatabaseConfig): ExecutionRepository {
    return new ExecutionRepository(openDatabase(config));
  }

  initialize(): Promise<void> {
    return this.database.initialize();
  }

  consumeRateLimit(bucket: string, maximum: number, windowSeconds: number, now = Date.now()): Promise<boolean> {
    return this.database.consumeRateLimit(bucket, maximum, windowSeconds, now);
  }

  async create(input: ExecutionCreate): Promise<Execution> {
    const now = new Date().toISOString();
    const execution = ExecutionSchema.parse({
      id: input.id,
      intent: input.intent,
      accountId: input.accountId,
      evmAddress: input.evmAddress ?? null,
      status: input.status,
      interpretation: input.interpretation,
      sourceTxHash: null,
      destinationTxHash: null,
      error: null,
      version: 0,
      createdAt: now,
      updatedAt: now,
    });
    await this.database.create<ExecutionDocument>(collection, input.id, {
      tokenHash: input.tokenHash,
      execution,
      context: null,
      submissions: {},
    });
    return execution;
  }

  async get(id: string, tokenHash: string): Promise<Execution | null> {
    return (await this.read(id, tokenHash))?.value.execution ?? null;
  }

  transition(
    id: string,
    tokenHash: string,
    expected: readonly ExecutionStatus[],
    patch: ExecutionPatch,
    expectedVersion?: number,
    context?: Record<string, unknown>,
  ): Promise<Execution | null> {
    return this.mutate(id, tokenHash, expected, expectedVersion, current => ({
      ...current,
      execution: { ...current.execution, ...patch },
      ...(context ? { context: JSON.parse(JSON.stringify(context)) } : {}),
    }));
  }

  commitPreparation(
    id: string,
    tokenHash: string,
    version: number,
    context: Record<string, unknown>,
  ): Promise<Execution | null> {
    return this.mutate(id, tokenHash, ["approved", "awaiting_signature"], version, current => ({
      ...current,
      context: JSON.parse(JSON.stringify(context)),
      execution: {
        ...current.execution,
        status: "awaiting_signature",
        sourceTxHash: null,
        error: null,
        stage: context.stage as Execution["stage"],
        stageNetwork: context.sourceChainKey as Execution["stageNetwork"],
        stageAction:
          (context.routeStages as Execution["stageAction"][] | undefined)?.[Number(context.stageIndex)] ??
          current.execution.stageAction,
      },
    }));
  }

  async submittedForVersion(id: string, tokenHash: string, version: number, txHash: string): Promise<Execution | null> {
    const current = await this.read(id, tokenHash);
    return current?.value.submissions[String(version)] === txHash ? current.value.execution : null;
  }

  recordSubmission(id: string, tokenHash: string, version: number, txHash: string): Promise<Execution | null> {
    return this.mutate(id, tokenHash, ["awaiting_signature"], version, current => ({
      ...current,
      submissions: { ...current.submissions, [String(version)]: txHash },
      execution: { ...current.execution, status: "submitted", sourceTxHash: txHash, error: null },
    }));
  }

  async pending(limit = 100): Promise<Array<{ id: string; tokenHash: string }>> {
    if (!Number.isInteger(limit) || limit < 1 || limit > 1000) throw new Error("Invalid pending execution limit");
    const documents = await this.database.list<ExecutionDocument>(collection, {
      path: ["execution", "status"],
      values: ["submitted", "settling"],
      orderBy: ["execution", "updatedAt"],
      limit,
    });
    return documents.map(document => ({ id: document.execution.id, tokenHash: document.tokenHash }));
  }

  async setContext(id: string, tokenHash: string, context: Record<string, unknown>): Promise<boolean> {
    const current = await this.read(id, tokenHash);
    if (!current) return false;
    return this.database.replace(collection, id, current.revision, {
      ...current.value,
      context: JSON.parse(JSON.stringify(context)),
    });
  }

  async getContext(id: string, tokenHash: string): Promise<Record<string, unknown> | null> {
    return (await this.read(id, tokenHash))?.value.context ?? null;
  }

  close(): Promise<void> {
    return this.database.close();
  }

  private async read(id: string, tokenHash: string): Promise<StoredDocument<ExecutionDocument> | null> {
    const document = await this.database.read<ExecutionDocument>(collection, id);
    if (!document || document.value.tokenHash !== tokenHash) return null;
    document.value.execution = ExecutionSchema.parse(document.value.execution);
    return document;
  }

  private async mutate(
    id: string,
    tokenHash: string,
    expected: readonly ExecutionStatus[],
    version: number | undefined,
    change: (current: ExecutionDocument) => ExecutionDocument,
  ): Promise<Execution | null> {
    const current = await this.read(id, tokenHash);
    if (
      !current ||
      !expected.includes(current.value.execution.status) ||
      (version !== undefined && current.value.execution.version !== version)
    )
      return null;
    const next = change(current.value);
    next.execution = ExecutionSchema.parse({
      ...next.execution,
      version: current.value.execution.version + 1,
      updatedAt: new Date().toISOString(),
    });
    return (await this.database.replace(collection, id, current.revision, next)) ? next.execution : null;
  }
}
