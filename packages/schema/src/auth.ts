export const CapabilityTokenPattern = /^[A-Za-z0-9_-]{40,}$/;

export function bearerCapability(authorization: string | null): string | null {
  const token = authorization?.match(/^Bearer (.+)$/)?.[1];
  return token && CapabilityTokenPattern.test(token) ? token : null;
}
