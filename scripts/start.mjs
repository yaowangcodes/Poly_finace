import { cp } from "node:fs/promises";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { resolve } from "node:path";
const root = fileURLToPath(new URL("../", import.meta.url));
// Load runtime configuration from the source project, not a build-time copy.
// Resolve Next's own loader so dev and production use the same .env precedence.
const require = createRequire(import.meta.url);
const nextRequire = createRequire(require.resolve("next/package.json"));
nextRequire("@next/env").loadEnvConfig(root, false);
await cp(`${root}.next/static`, `${root}.next/standalone/.next/static`, {
  recursive: true,
});
await cp(`${root}public`, `${root}.next/standalone/public`, {
  recursive: true,
});
const child = spawn(process.execPath, [`${root}.next/standalone/server.js`], {
  cwd: root,
  stdio: "inherit",
  env: {
    ...process.env,
    NODE_ENV: "production",
    HOSTNAME: process.env.HOSTNAME ?? "127.0.0.1",
    // Resolve local persistence against the project, consistently with next dev.
    DATA_DIR: resolve(root, process.env.DATA_DIR ?? ".data"),
  },
});
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => child.kill(signal));
child.on("error", (error) => {
  console.error("Could not start the website:", error.message);
  process.exit(1);
});
child.on("exit", (code, signal) => process.exit(code ?? (signal ? 0 : 1)));
