import { spawn } from "node:child_process";

if (!process.argv.includes("--broadcast")) throw new Error("Live validation requires an explicit --broadcast flag");
const cases = process.argv.slice(process.argv.indexOf("--broadcast") + 1);
if (!cases.length) throw new Error("Provide the validation case names");
for (const name of cases) {
  const exitCode = await new Promise<number | null>((resolve, reject) => {
    const child = spawn(
      process.execPath,
      ["--conditions=source", "--import", "tsx", "scripts/live-testnet.mts", "--broadcast", "--case", name],
      { stdio: "inherit" },
    );
    child.once("error", reject);
    child.once("exit", resolve);
  });
  if (exitCode !== 0) {
    process.exitCode = exitCode || 1;
    break;
  }
}
