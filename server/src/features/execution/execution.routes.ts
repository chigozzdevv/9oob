import * as controller from "./execution.controller.js";
import type { ExecutionService } from "./execution.service.js";
import { getBearerToken, isAllowedOrigin } from "../../shared/auth/auth.middleware.js";
import { jsonResponse } from "../../shared/http/http.response.js";

export async function executionRoute(
  request: Request,
  getService: () => ExecutionService,
  appOrigin?: string,
): Promise<Response> {
  const path = new URL(request.url).pathname.replace(/\/$/, "");
  if (request.method !== "GET" && !isAllowedOrigin(request, appOrigin))
    return jsonResponse({ error: "Request origin is not allowed" }, 403);
  if (path === "/api/noob/executions" && request.method === "POST")
    return controller.startExecution(request, getService);
  const match = path.match(
    /^\/api\/noob\/executions\/([^/]+)(?:\/(wallet|clarify|approve|prepare|submitted|cancel))?$/,
  );
  if (!match) return jsonResponse({ error: "Route not found" }, 404);
  if (!getBearerToken(request)) return jsonResponse({ error: "Invalid execution capability" }, 401);
  const [, id, action] = match;
  if (!action && request.method === "GET") return controller.readExecution(request, id, getService);
  if (!action && request.method === "PATCH") return controller.reviseExecution(request, id, getService);
  const actions = {
    wallet: controller.connectExecutionWallet,
    clarify: controller.clarifyExecution,
    approve: controller.approveExecution,
    prepare: controller.prepareExecution,
    submitted: controller.submittedExecution,
    cancel: controller.cancelExecution,
  };
  if (action && request.method === "POST") return actions[action as keyof typeof actions](request, id, getService);
  return jsonResponse({ error: "Method not allowed" }, 405);
}
