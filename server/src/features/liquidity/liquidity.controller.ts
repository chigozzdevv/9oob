import { jsonResponse } from "../../shared/http/http.response.js";
import type { LiquidityService } from "./liquidity.service.js";

export async function readLiquidity(service: LiquidityService): Promise<Response> {
  try {
    return jsonResponse(await service.read());
  } catch {
    return jsonResponse({ error: "Live bridge pool balances are temporarily unavailable" }, 503);
  }
}
