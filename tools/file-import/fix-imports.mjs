/**
 * Launcher: `node tools/file-import/fix-imports.mjs` from repo root.
 */
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../..");
const r = spawnSync(
  process.platform === "win32" ? "npx.cmd" : "npx",
  [
    "ts-node",
    "--project",
    "tools/file-import/fix-imports.tsconfig.json",
    "tools/file-import/fix-imports.ts",
  ],
  { cwd: repoRoot, stdio: "inherit", env: process.env, shell: process.platform === "win32" }
);
process.exit(r.status ?? 1);
