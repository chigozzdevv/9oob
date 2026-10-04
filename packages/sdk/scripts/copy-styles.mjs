import { copyFileSync } from "node:fs";

copyFileSync(new URL("../src/modal/modal.css", import.meta.url), new URL("../dist/modal/modal.css", import.meta.url));
