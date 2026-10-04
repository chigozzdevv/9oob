export function jsonResponse(body: unknown, status = 200, headers?: HeadersInit): Response {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store", ...headers } });
}

export function rateLimited(): Response {
  return jsonResponse({ error: "Too many intent requests. Try again in a minute." }, 429, { "Retry-After": "60" });
}
