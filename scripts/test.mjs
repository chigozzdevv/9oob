import { readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";

function tests(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? tests(path) : entry.name.endsWith(".test.ts") ? [path] : [];
  });
}

const files = ["server/test", "packages/schema/test", "packages/sdk/test", "packages/nextjs/test"].flatMap(tests);
const result = spawnSync(
  process.execPath,
  ["--conditions=source", "--import", "tsx", "--import", "./scripts/test-setup.mjs", "--test", ...files],
  {
    stdio: "inherit",
  },
);
if (result.error) throw result.error;
process.exit(result.status ?? 1);
