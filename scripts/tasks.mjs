import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
const root = fileURLToPath(new URL("../", import.meta.url));
const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const tasks = {
  setup: [
    ["backend", "ci"],
    ["frontend", "ci"],
  ],
  build: [
    ["backend", "run", "build"],
    ["frontend", "run", "build"],
  ],
  check: [
    ["backend", "run", "typecheck"],
    ["frontend", "run", "typecheck"],
    ["frontend", "run", "lint"],
  ],
  test: [
    ["backend", "test"],
    ["frontend", "test"],
  ],
  e2e: [["frontend", "exec", "--", "playwright", "test"]],
};
const task = process.argv[2];
if (!tasks[task]) throw new Error(`Unknown task: ${task}`);
for (const [directory, ...args] of tasks[task]) {
  const result = spawnSync(npm, args, {
    cwd: path.join(root, directory),
    stdio: "inherit",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status || 1);
}
