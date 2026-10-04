import type { ExecutionService } from "./execution.service.js";
import type { ExecutionRepository } from "./execution.repo.js";
import { logger } from "../../shared/logging/logger.js";

export async function reconcilePending(store: ExecutionRepository, service: ExecutionService): Promise<void> {
  for (const pending of await store.pending()) {
    try {
      await service.refreshStored(pending.id, pending.tokenHash);
    } catch {
      logger.warn(`Settlement check deferred for ${pending.id}`);
    }
  }
}

export function startExecutionWorker(
  store: ExecutionRepository,
  service: ExecutionService,
  interval = 5000,
): () => void {
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      await reconcilePending(store, service);
    } catch {
      logger.warn("Pending execution scan deferred");
    } finally {
      running = false;
    }
  };
  const timer = setInterval(() => void tick(), interval);
  timer.unref();
  void tick();
  return () => clearInterval(timer);
}
