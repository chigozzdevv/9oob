import { bearerCapability } from "@9oob/schema";
import { hashCapability } from "./auth.service.js";

export function getBearerToken(request: Request): string | null {
  return bearerCapability(request.headers.get("authorization"));
}

export function isAllowedOrigin(request: Request, appOrigin?: string): boolean {
  const origin = request.headers.get("origin");
  return origin !== null && (origin === new URL(request.url).origin || origin === appOrigin);
}

export function requestRateBucket(request: Request): string {
  const address = (
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    "unknown"
  ).slice(0, 128);
  return hashCapability(`intent:${address}`);
}
