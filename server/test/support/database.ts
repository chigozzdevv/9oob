import { PGlite } from "@electric-sql/pglite";
import { ExecutionRepository } from "../../src/features/execution/execution.repo.js";
import { PostgresDatabase } from "../../src/shared/database/postgres.client.js";

export async function createTestRepository(directory?: string): Promise<ExecutionRepository> {
  const engine = new PGlite(directory);
  const database = new PostgresDatabase({
    async query(sql, parameters) {
      if (!parameters) {
        await engine.exec(sql);
        return { rows: [] };
      }
      return engine.query<Record<string, unknown>>(sql, parameters);
    },
    close: () => engine.close(),
  });
  const repository = new ExecutionRepository(database);
  await repository.initialize();
  return repository;
}
