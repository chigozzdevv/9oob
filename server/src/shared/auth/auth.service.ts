import { createHash, randomBytes, randomUUID } from "node:crypto";

export function createCapability(): { id: string; token: string; tokenHash: string } {
  const token = randomBytes(32).toString("base64url");
  return { id: randomUUID(), token, tokenHash: hashCapability(token) };
}

export function hashCapability(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
