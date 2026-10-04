import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const yarn = fileURLToPath(new URL("../.yarn/releases/yarn-3.2.3.cjs", import.meta.url));
const children = ["@9oob/server", "@9oob/client"].map(workspace =>
  spawn(process.execPath, [yarn, "workspace", workspace, "dev"], {
    cwd: root,
    stdio: "inherit",
    detached: process.platform !== "win32",
  }),
);
let stopping = false;
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of children) {
    try {
      if (process.platform !== "win32" && child.pid) process.kill(-child.pid, "SIGTERM");
      else child.kill("SIGTERM");
    } catch {}
  }
  process.exitCode = code;
}
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => stop());
for (const child of children) {
  child.on("error", error => {
    console.error(error.message);
    stop(1);
  });
  child.on("exit", code => stop(code ?? 1));
}
