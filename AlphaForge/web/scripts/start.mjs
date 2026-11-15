import { cp } from "node:fs/promises";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("../", import.meta.url));
await cp(`${root}.next/static`, `${root}.next/standalone/.next/static`, {
  recursive: true,
});
await cp(`${root}public`, `${root}.next/standalone/public`, {
  recursive: true,
});
const child = spawn(process.execPath, [`${root}.next/standalone/server.js`], {
  stdio: "inherit",
  env: { ...process.env, HOSTNAME: process.env.HOSTNAME ?? "127.0.0.1" },
});
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => child.kill(signal));
child.on("exit", (code) => process.exit(code ?? 1));
