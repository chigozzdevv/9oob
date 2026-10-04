import { spawnSync } from "node:child_process";
import { rmSync } from "node:fs";
import { fileURLToPath } from "node:url";

const yarnPath = fileURLToPath(new URL("../.yarn/releases/yarn-3.2.3.cjs", import.meta.url));
const packageBuilds = [
  ["workspace", "@9oob/schema", "build"],
  ["workspace", "@9oob/server", "build"],
  ["workspace", "@9oob/sdk", "build"],
];
const actions = new Map([
  ["packages", packageBuilds],
  ["build", [...packageBuilds, ["workspace", "@9oob/client", "build"]]],
  ["dev", packageBuilds],
]);
const selected = actions.get(process.argv[2]);
const outputDirectories = {
  "@9oob/schema": "../packages/schema/dist",
  "@9oob/server": "../server/dist",
  "@9oob/sdk": "../packages/sdk/dist",
};

if (!selected) throw new Error("Choose packages, build, or dev");

for (const args of selected) {
  if (args[2] === "build" && args[1] in outputDirectories) {
    rmSync(new URL(outputDirectories[args[1]], import.meta.url), { recursive: true, force: true });
  }
  const result = spawnSync(process.execPath, [yarnPath, ...args], { stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

if (process.argv[2] === "dev") {
  const result = spawnSync(process.execPath, [fileURLToPath(new URL("./dev.mjs", import.meta.url))], {
    stdio: "inherit",
  });
  if (result.error) throw result.error;
  process.exit(result.status ?? 1);
}
