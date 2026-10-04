import { createServer } from "node:http";
import { createNoobApp } from "./app.js";
import { logger } from "./shared/logging/logger.js";

const app = createNoobApp();
if (process.env.OPENAI_API_KEY?.trim()) await app.start();
const host = process.env.NOOB_SERVER_HOST || "127.0.0.1";
const port = Number(process.env.NOOB_SERVER_PORT || 3001);
const server = createServer(async (incoming, outgoing) => {
  try {
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of incoming) {
      size += chunk.length;
      if (size > 64 * 1024) {
        outgoing.writeHead(413);
        outgoing.end("Request too large");
        return;
      }
      chunks.push(Buffer.from(chunk));
    }
    const headers = new Headers();
    for (const [key, value] of Object.entries(incoming.headers)) {
      if (value !== undefined) headers.set(key, Array.isArray(value) ? value.join(", ") : value);
    }
    const method = incoming.method || "GET";
    const response = await app.fetch(
      new Request(`http://${host}:${port}${incoming.url || "/"}`, {
        method,
        headers,
        ...(method === "GET" || method === "HEAD" ? {} : { body: Buffer.concat(chunks) }),
      }),
    );
    outgoing.writeHead(response.status, Object.fromEntries(response.headers));
    outgoing.end(Buffer.from(await response.arrayBuffer()));
  } catch {
    outgoing.writeHead(500);
    outgoing.end("Request failed");
  }
});
server.listen(port, host, () => logger.info(`Execution server listening at http://${host}:${port}`));
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.on(signal, () => {
    server.close(() => void app.close().finally(() => process.exit(0)));
  });
