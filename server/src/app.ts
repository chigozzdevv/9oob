import {
  ExecutionService,
  ExecutionRepository,
  executionRoute,
  startExecutionWorker,
} from "./features/execution/index.js";
import { IntentService } from "./features/intent/index.js";
import { readServerConfig, ConfigurationError } from "./shared/config/env.js";
import { jsonResponse } from "./shared/http/http.response.js";
import { LiquidityService, liquidityRoute } from "./features/liquidity/index.js";
import { isAllowedServerKey } from "./shared/auth/auth.middleware.js";

export function createNoobApp(
  options: { service?: ExecutionService; appOrigin?: string; serverApiKey?: string; worker?: boolean } = {},
) {
  let service = options.service;
  let store: ExecutionRepository | undefined;
  let stopWorker: (() => void) | undefined;
  const liquidity = new LiquidityService();
  const getService = () => {
    if (!service) {
      const config = readServerConfig();
      store = ExecutionRepository.fromConfig(config.database);
      service = new ExecutionService(store, new IntentService(config.openAiApiKey, config.openAiModel));
      if (options.worker !== false) stopWorker = startExecutionWorker(store, service);
    }
    return service;
  };
  return {
    async start() {
      const execution = getService();
      await store?.initialize();
      return execution;
    },
    async fetch(request: Request): Promise<Response> {
      if (new URL(request.url).pathname === "/health" && request.method === "GET")
        return jsonResponse({
          status: "ok",
          configured: Boolean(options.service || process.env.OPENAI_API_KEY?.trim()),
        });
      if (!isAllowedServerKey(request, options.serverApiKey ?? process.env.NOOB_SERVER_API_KEY?.trim()))
        return jsonResponse({ error: "Execution server access is not allowed" }, 401);
      try {
        const pools = liquidityRoute(request, liquidity);
        if (pools) return pools;
        return await executionRoute(request, getService, options.appOrigin ?? process.env.NOOB_APP_ORIGIN);
      } catch (error) {
        const missingConfig = error instanceof ConfigurationError;
        return jsonResponse(
          { error: missingConfig ? error.message : "Execution service is temporarily unavailable" },
          missingConfig ? 503 : 502,
        );
      }
    },
    async close() {
      stopWorker?.();
      await store?.close();
    },
  };
}
