#!/usr/bin/env node
import { createReadStream, createWriteStream, constants } from "node:fs";
import { copyFile, lstat, mkdir, mkdtemp, readFile, realpath, rename, rm, chmod } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));
const knownGroups = new Set(["runtime", "public", "evaluation", "sources"]);
const archive = /\.(?:zip|tar|tgz|gz|bz2|xz|7z|rar)$/i;

function targetPath(value) {
  if (typeof value !== "string" || !value || value.includes("\\") || value.includes("\0") || path.isAbsolute(value) || /^[a-z]:/i.test(value) || value.split("/").some(part => !part || part === "." || part === ".."))
    throw new Error(`Unsafe media target path: ${JSON.stringify(value)}`);
  return value;
}

function validateManifest(manifest) {
  if (!manifest || manifest.version !== 1 || typeof manifest.release !== "string" || !Array.isArray(manifest.assets))
    throw new Error("Expected a version-1 media manifest with release and assets.");
  const names = new Set(), targets = new Map();
  for (const asset of manifest.assets) {
    if (typeof asset.name !== "string" || !asset.name || names.has(asset.name) || !/^[a-f0-9]{64}$/.test(asset.sha256) || !Number.isSafeInteger(asset.size) || asset.size < 0 || !Array.isArray(asset.targets) || !asset.targets.length)
      throw new Error(`Invalid or duplicate media asset: ${asset.name || "unnamed"}`);
    names.add(asset.name);
    const url = new URL(asset.url);
    if (!["https:", "http:"].includes(url.protocol) || url.username || url.password)
      throw new Error(`Invalid media URL for ${asset.name}.`);
    for (const target of asset.targets) {
      targetPath(target.path);
      if (!Array.isArray(target.groups) || !target.groups.length || target.groups.some(group => !knownGroups.has(group)))
        throw new Error(`Invalid groups for ${target.path}.`);
      const identity = `${asset.sha256}:${asset.size}`;
      if (targets.has(target.path) && targets.get(target.path) !== identity)
        throw new Error(`Conflicting media assets target ${target.path}.`);
      targets.set(target.path, identity);
    }
  }
}

async function ensureSafeTarget(root, relative) {
  let current = root;
  for (const segment of relative.split("/")) {
    current = path.join(current, segment);
    try {
      const stat = await lstat(current);
      if (stat.isSymbolicLink()) throw new Error(`Symlink media target is not allowed: ${relative}`);
      if (current !== path.join(root, relative) && !stat.isDirectory()) throw new Error(`Media target parent is not a directory: ${relative}`);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
  const resolved = path.resolve(root, relative);
  if (!resolved.startsWith(root + path.sep)) throw new Error(`Media target escapes root: ${relative}`);
  return resolved;
}

async function matches(file, asset) {
  try {
    const stat = await lstat(file);
    if (!stat.isFile() || stat.size !== asset.size) return false;
    const hash = createHash("sha256");
    for await (const chunk of createReadStream(file)) hash.update(chunk);
    return hash.digest("hex") === asset.sha256;
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}

async function writeAtomically(source, destination) {
  await mkdir(path.dirname(destination), { recursive: true });
  const temporary = path.join(path.dirname(destination), `.${path.basename(destination)}.${randomUUID()}.partial`);
  try {
    await copyFile(source, temporary, constants.COPYFILE_EXCL | constants.COPYFILE_FICLONE);
    await chmod(temporary, 0o644);
    await rename(temporary, destination);
  } finally {
    await rm(temporary, { force: true });
  }
}

/** Download content once, verify it before publishing any destination, and retain good files. */
export async function downloadAssets({
  manifestPath = path.join(repositoryRoot, "deployment/media-manifest.json"),
  root = repositoryRoot,
  groups = ["runtime"],
  all = false,
  omitArchives = false,
  concurrency = 2,
  timeoutMs = 180_000,
  onEvent = () => {},
} = {}) {
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 2 || !Number.isInteger(timeoutMs) || timeoutMs < 1)
    throw new Error("Use concurrency 1–2 and a positive timeout.");
  if (!Array.isArray(groups) || groups.some(group => !knownGroups.has(group))) throw new Error("Unknown media group.");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  validateManifest(manifest);
  await mkdir(root, { recursive: true });
  root = await realpath(root);
  const selected = new Map();
  for (const asset of manifest.assets) {
    if (omitArchives && (archive.test(asset.name) || archive.test(new URL(asset.url).pathname))) continue;
    const requested = asset.targets.filter(target => all || target.groups.some(group => groups.includes(group)));
    if (!requested.length) continue;
    const identity = `${asset.sha256}:${asset.size}`;
    const item = selected.get(identity) || { ...asset, destinations: new Set() };
    for (const target of requested) item.destinations.add(await ensureSafeTarget(root, target.path));
    selected.set(identity, item);
  }
  const assets = [...selected.values()];
  const workspace = await mkdtemp(path.join(tmpdir(), "process-guide-media-"));
  const stop = new AbortController();
  const summary = { assets: assets.length, downloaded: 0, reused: 0, copied: 0, downloaded_bytes: 0 };
  let next = 0;
  try {
    async function worker() {
      while (!stop.signal.aborted && next < assets.length) {
        const asset = assets[next++];
        try {
          const destinations = [...asset.destinations], good = [];
          for (const destination of destinations) if (await matches(destination, asset)) good.push(destination);
          let source = good[0];
          if (source) {
            summary.reused++;
          } else {
            const signal = AbortSignal.any([stop.signal, AbortSignal.timeout(timeoutMs)]);
            const response = await fetch(asset.url, { signal });
            if (!response.ok || !response.body) throw new Error(`HTTP ${response.status}`);
            source = path.join(workspace, `${randomUUID()}.asset`);
            const hash = createHash("sha256");
            let bytes = 0;
            const verify = new Transform({
              transform(chunk, _encoding, callback) {
                bytes += chunk.length;
                if (bytes > asset.size) return callback(new Error("Downloaded media exceeds the manifest size."));
                hash.update(chunk);
                callback(null, chunk);
              },
            });
            await pipeline(Readable.fromWeb(response.body), verify, createWriteStream(source, { flags: "wx", mode: 0o600 }), { signal });
            if (bytes !== asset.size || hash.digest("hex") !== asset.sha256) throw new Error("Downloaded media does not match the manifest size/SHA256.");
            summary.downloaded++;
            summary.downloaded_bytes += bytes;
          }
          for (const destination of destinations) {
            if (good.includes(destination)) continue;
            await ensureSafeTarget(root, path.relative(root, destination).split(path.sep).join("/"));
            await writeAtomically(source, destination);
            summary.copied++;
          }
          onEvent({ name: asset.name, reused: good.length > 0, targets: destinations.length });
        } catch (error) {
          stop.abort(error);
          throw new Error(`Media asset ${asset.name}: ${error.message}`, { cause: error });
        }
      }
    }
    const workers = await Promise.allSettled(Array.from({ length: Math.min(concurrency, assets.length) }, worker));
    const failure = workers.find(result => result.status === "rejected");
    if (failure) throw failure.reason;
    return summary;
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
}

async function main() {
  const args = process.argv.slice(2), options = {}, groups = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--help") {
      console.log("Download verified release media: [--group runtime|public|evaluation|sources] [--omit-archives] [--all] [--manifest file] [--root directory]");
      return;
    }
    if (arg === "--all") options.all = true;
    else if (arg === "--omit-archives") options.omitArchives = true;
    else if (["--group", "--manifest", "--root"].includes(arg)) {
      const value = args[++i];
      if (!value || value.startsWith("--")) throw new Error(`Missing value after ${arg}.`);
      if (arg === "--group") groups.push(...value.split(","));
      else options[arg === "--manifest" ? "manifestPath" : "root"] = path.resolve(value);
    } else throw new Error(`Unknown option: ${arg}`);
  }
  if (options.all && groups.length) throw new Error("Choose --all or --group, not both.");
  if (groups.length) options.groups = groups;
  const summary = await downloadAssets(options);
  console.log(`Verified media: ${summary.assets} assets; ${summary.downloaded} downloaded, ${summary.reused} reused, ${summary.copied} destinations written (${summary.downloaded_bytes} downloaded bytes).`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href)
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
