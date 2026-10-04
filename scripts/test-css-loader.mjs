import { readFile } from "node:fs/promises";

export async function load(url, context, nextLoad) {
  if (!url.endsWith(".css")) return nextLoad(url, context);
  await readFile(new URL(url), "utf8");
  return { format: "module", source: "export default {};", shortCircuit: true };
}
