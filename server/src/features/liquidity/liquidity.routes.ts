import { readLiquidity } from "./liquidity.controller.js";
import type { LiquidityService } from "./liquidity.service.js";
import { jsonResponse } from "../../shared/http/http.response.js";

export function liquidityRoute(request: Request, service: LiquidityService): Promise<Response> | null {
  if (new URL(request.url).pathname.replace(/\/$/, "") !== "/api/noob/liquidity") return null;
  return request.method === "GET"
    ? readLiquidity(service)
    : Promise.resolve(jsonResponse({ error: "Method not allowed" }, 405));
}
