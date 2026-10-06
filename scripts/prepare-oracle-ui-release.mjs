import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { copyFile, lstat, mkdir, mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const directory = await mkdtemp(path.join(os.tmpdir(), "cueveris-ui-release-"));
const context = path.join(directory, "context");
await mkdir(context);

const files = [
  "frontend/dist/index.html",
  "frontend/dist/favicon.svg",
  "frontend/dist/media/cueveris-manufacturing-demo.mp4",
  "frontend/dist/media/cueveris-manufacturing-demo.jpg",
  "frontend/dist/media/cueveris-manufacturing-demo.json",
  "frontend/dist/media/cueveris-manufacturing-demo.txt",
  "frontend/dist/media/process-guide-real-scenarios/index.html",
  "frontend/dist/INTER-LICENSE.txt",
  "backend/dist/app.js",
  "backend/dist/media/analysisPdf.js",
  "backend/dist/media/analysisReport.js",
];
async function addAssets(relative) {
  for (const entry of await readdir(path.join(root, relative), { withFileTypes: true })) {
    const name = path.join(relative, entry.name);
    if (entry.isDirectory()) await addAssets(name);
    else if (entry.isFile()) files.push(name);
    else throw new Error(`Release asset must be a regular file: ${name}`);
  }
}
await addAssets("frontend/dist/assets");

const hashes = [];
const receipt = [];
for (const relative of files.sort()) {
  const source = path.join(root, relative);
  if (!(await lstat(source)).isFile()) throw new Error(`Release input must be a regular file: ${relative}`);
  const destination = path.join(context, relative);
  await mkdir(path.dirname(destination), { recursive: true });
  await copyFile(source, destination);
  const bytes = await readFile(destination);
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  hashes.push(`${sha256}  ${relative}`);
  receipt.push({ path: relative, size: bytes.length, sha256 });
}

for (const [source, destination] of [
  ["deployment/oracle/Dockerfile.ui-style", "Dockerfile"],
  ["deployment/oracle/ui-style.override.yml", "ui-style.override.yml"],
  ["deployment/oracle/deploy-ui-style.sh", "deploy-ui-style.sh"],
]) {
  const bytes = await readFile(path.join(root, source));
  await writeFile(path.join(context, destination), bytes);
  hashes.push(`${createHash("sha256").update(bytes).digest("hex")}  ${destination}`);
}

const revision = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
const sourceDirty = execFileSync("git", ["status", "--porcelain", "--untracked-files=normal"], {
  cwd: root, encoding: "utf8",
}).trim().length > 0;
const release = JSON.stringify({
  format: 1,
  source_revision: revision,
  source_dirty: sourceDirty,
  prepared_at: new Date().toISOString(),
  base_image: "process-guide:oracle-cueveris-20261006",
  image: "process-guide:oracle-design-20261006",
  files: receipt,
}, null, 2) + "\n";
await writeFile(path.join(context, "release.json"), release);
hashes.push(`${createHash("sha256").update(release).digest("hex")}  release.json`);
await writeFile(path.join(context, "SHA256SUMS"), hashes.join("\n") + "\n");
await writeFile(path.join(context, "app-SHA256SUMS"), receipt.map(file =>
  `${file.sha256}  /app/${file.path}`
).join("\n") + "\n");

const archive = path.join(directory, "cueveris-ui-release.tar.gz");
execFileSync("tar", ["-czf", archive, "-C", context, "."]);
const archiveSha256 = createHash("sha256").update(await readFile(archive)).digest("hex");
console.log(JSON.stringify({ directory, context, archive, sha256: archiveSha256, source_revision: revision, source_dirty: sourceDirty, files: receipt.length }, null, 2));
