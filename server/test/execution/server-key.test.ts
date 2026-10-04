import assert from "node:assert/strict";
import test from "node:test";
import { createNoobApp } from "../../src/app.js";

test("a protected execution server rejects direct access before interpreting or connecting to storage", async () => {
  const app = createNoobApp({ serverApiKey: "private-server-key", worker: false });
  for (const key of [undefined, "wrong", "private-server-key-wrong", "a".repeat(4096)]) {
    const response = await app.fetch(
      new Request("http://backend/api/noob/executions", {
        method: "POST",
        headers: key ? { "x-noob-server-key": key } : {},
        body: "{}",
      }),
    );
    assert.equal(response.status, 401);
  }
  const allowed = await app.fetch(
    new Request("http://backend/unknown", {
      headers: { "x-noob-server-key": "private-server-key" },
    }),
  );
  assert.equal(allowed.status, 404);
  const health = await app.fetch(new Request("http://backend/health"));
  assert.equal(health.status, 200);
  await app.close();
});
