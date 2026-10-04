import { createHttpTransport } from "../src/transport/http.js";
import assert from "node:assert/strict";
import test from "node:test";

test("a host configures its API endpoint once and capabilities travel in the authorization header", async () => {
  const originalFetch = globalThis.fetch;
  const calls: Array<{ url: string; headers: Headers }> = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), headers: new Headers(init?.headers) });
    return Response.json({ result: "ok" });
  };
  try {
    const api = createHttpTransport("/custom/intent/");
    assert.deepEqual(await api("/executions/id", "test-capability"), { result: "ok" });
    assert.equal(calls[0].url, "/custom/intent/executions/id");
    assert.equal(calls[0].headers.get("Authorization"), "Bearer test-capability");
    await createHttpTransport()("/executions");
    assert.equal(calls[1].url, "/api/noob/executions");
    assert.equal(calls[1].headers.has("Authorization"), false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
