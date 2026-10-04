export type NoobTransport = <T>(path: string, token?: string, init?: RequestInit) => Promise<T>;

export function createHttpTransport(endpoint = "/api/noob"): NoobTransport {
  const base = endpoint.replace(/\/$/, "");
  return async <T>(path: string, token?: string, init: RequestInit = {}): Promise<T> => {
    const response = await fetch(`${base}${path}`, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...init.headers,
      },
      cache: "no-store",
    });
    const body = (await response.json().catch(() => ({}))) as { error?: string };
    if (!response.ok) throw new Error(body.error ?? `Request failed (${response.status})`);
    return body as T;
  };
}
