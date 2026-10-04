import { bearerCapability } from "@9oob/schema";
import { hashCapability } from "./auth.service.js";
import { timingSafeEqual } from "node:crypto";

export function isAllowedServerKey(request: Request, requiredKey?: string): boolean {
  if (!requiredKey) return true;
  const supplied = request.headers.get("x-noob-server-key");
  return (
    supplied !== null &&
    timingSafeEqual(Buffer.from(hashCapability(supplied)), Buffer.from(hashCapability(requiredKey)))
  );
}

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
