import assert from "node:assert/strict";
import test from "node:test";
import { proxyExecutionRequest } from "../services/execution-proxy";

test("proxy checks the public host when Next rewrites its internal request URL", async context => {
  const body = JSON.stringify({ intent: "Check my HBAR balance", accountId: "0.0.123", evmAddress: null });
  const calls: { url: string; options?: RequestInit }[] = [];
  context.mock.method(globalThis, "fetch", async (url: URL, options?: RequestInit) => {
    calls.push({ url: url.toString(), options });
    return Response.json({ error: "OPENAI_API_KEY is required by the 9oob server" }, { status: 503 });
  });
  const response = await proxyExecutionRequest(
    new Request("http://localhost:3000/api/noob/executions", {
      method: "POST",
      headers: {
        host: "127.0.0.1:3000",
        origin: "http://127.0.0.1:3000",
        "content-type": "application/json",
        authorization: "Bearer capability",
      },
      body,
    }),
  );
  assert.equal(response.status, 503);
  assert.equal(calls.length, 1);
  assert.equal(new URL(calls[0].url).pathname, "/api/noob/executions");
  assert.equal(calls[0].options?.body, body);
  const headers = new Headers(calls[0].options?.headers);
  assert.equal(headers.get("origin"), "http://127.0.0.1:3000");
  assert.equal(headers.get("authorization"), "Bearer capability");
  assert.equal(response.headers.get("cache-control"), "no-store");
});

test("proxy rejects foreign and missing origins before contacting the server", async context => {
  let calls = 0;
  context.mock.method(globalThis, "fetch", async () => {
    calls += 1;
    return Response.json({});
  });
  for (const origin of [null, "https://foreign.example", "http://localhost:3000"]) {
    const headers = new Headers({ host: "127.0.0.1:3000" });
    if (origin) headers.set("origin", origin);
    const response = await proxyExecutionRequest(
      new Request("http://localhost:3000/api/noob/executions", { method: "POST", headers, body: "{}" }),
    );
    assert.equal(response.status, 403);
  }
  assert.equal(calls, 0);
});
