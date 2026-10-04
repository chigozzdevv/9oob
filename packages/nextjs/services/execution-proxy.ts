export async function proxyExecutionRequest(request: Request): Promise<Response> {
  const requestUrl = new URL(request.url);
  const origin = `${requestUrl.protocol}//${request.headers.get("host") || requestUrl.host}`;
  if (request.method !== "GET" && request.headers.get("origin") !== origin)
    return Response.json({ error: "Request origin is not allowed" }, { status: 403 });
  const base = new URL(process.env.NOOB_SERVER_URL || "http://127.0.0.1:3001");
  const target = new URL(requestUrl.pathname, base);
  const headers = new Headers();
  for (const name of ["content-type", "authorization", "origin", "x-forwarded-for", "x-real-ip"]) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }
  const serverApiKey = process.env.NOOB_SERVER_API_KEY?.trim();
  if (serverApiKey) headers.set("x-noob-server-key", serverApiKey);
  try {
    const response = await fetch(target, {
      method: request.method,
      headers,
      ...(request.method === "GET" ? {} : { body: await request.text() }),
      cache: "no-store",
      signal: AbortSignal.timeout(60_000),
      redirect: "error",
    });
    return new Response(response.body, {
      status: response.status,
      headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
    });
  } catch {
    return Response.json({ error: "Execution server is temporarily unavailable. Please try again." }, { status: 503 });
  }
}
