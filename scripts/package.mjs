import { mkdir, cp, rm } from "node:fs/promises";
import { resolve, join } from "node:path";
import { spawnSync } from "node:child_process";
const root = resolve(import.meta.dirname, "..");
const stage = join(root, "build", "staging");
// This fixed, workspace-local staging directory contains only generated copies.
await rm(stage, { recursive: true, force: true });
await mkdir(stage, { recursive: true });
for (const path of [
  "package.json",
  "package-lock.json",
  "Dockerfile",
  "index.html",
  "vite.config.js",
  "public",
  "web",
  "server",
])
  await cp(join(root, path), join(stage, path), { recursive: true });
const archive = join(root, "build", "navalnyvpn.tar.gz");
const result = spawnSync("tar", ["-czf", archive, "-C", stage, "."], {
  stdio: "inherit",
  shell: false,
});
if (result.status !== 0) process.exit(result.status || 1);
console.log("AWS deployment artifact: " + archive);
