import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
const root = fileURLToPath(new URL("../", import.meta.url));
if (Number(process.versions.node.split(".")[0]) < 24) {
  console.error("Process Guide requires Node.js 24 or newer. On this Mac run: fnm exec --using=24.18.0 npm start");
  process.exit(1);
}
for (const name of ["frontend", "backend"]) {
  if (!fs.existsSync(path.join(root, name, "node_modules"))) {
    console.error(
      "Dependencies are missing. Run npm run setup in guidance-app first.",
    );
    process.exit(1);
  }
}
if (
  !fs.existsSync(path.join(root, "frontend/dist/index.html")) ||
  !fs.existsSync(path.join(root, "backend/dist/server.js"))
) {
  const build = spawnSync(
    process.execPath,
    [path.join(root, "scripts/tasks.mjs"), "build"],
    { stdio: "inherit" },
  );
  if (build.status !== 0) process.exit(build.status || 1);
}
const server = spawn(process.execPath, ["dist/server.js"], {
  cwd: path.join(root, "backend"),
  stdio: "inherit",
});
console.log(
  "Process Guide starts at http://localhost:8101 (or the PORT in backend/.env). Keep this terminal open.",
);
for (const signal of ["SIGINT", "SIGTERM"])
  process.once(signal, () => server.kill(signal));
server.once("error", (error) => {
  console.error(error.message);
  process.exit(1);
});
server.once("exit", (code) => process.exit(code || 0));
