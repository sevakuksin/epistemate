#!/usr/bin/env node
/**
 * Install local packages in order without npm workspaces (avoids symlink EISDIR
 * when Windows npm runs against a WSL filesystem).
 */
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.join(__dirname, "..");

const packages = [
  "packages/shared",
  "packages/engine",
  "apps/server",
  "apps/web",
];

for (const rel of packages) {
  const cwd = path.join(rootDir, rel);
  if (!fs.existsSync(path.join(cwd, "package.json"))) {
    console.warn(`[bootstrap] skip (no package.json): ${rel}`);
    continue;
  }
  console.log(`[bootstrap] npm install in ${rel}`);
  execSync("npm install", { cwd, stdio: "inherit", env: process.env });
}
