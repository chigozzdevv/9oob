import { ExecutionRepository } from "./features/execution/execution.repo.js";
import { ExecutionService } from "./features/execution/execution.service.js";
import { IntentService } from "./features/intent/intent.service.js";
import { readServerConfig } from "./shared/config/env.js";
import { startExecutionWorker } from "./features/execution/execution.worker.js";

const config = readServerConfig();
const store = ExecutionRepository.fromConfig(config.database);
await store.initialize();
const service = new ExecutionService(store, new IntentService(config.openAiApiKey, config.openAiModel));
const stop = startExecutionWorker(store, service);
const keepAlive = setInterval(() => undefined, 60_000);
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.on(signal, () => {
    stop();
    clearInterval(keepAlive);
    void store.close();
  });
