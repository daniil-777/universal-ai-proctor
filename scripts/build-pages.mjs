import { spawn } from "node:child_process";
import { cp, lstat, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const publicRoot = path.join(root, "frontend/public");
const output = path.join(root, ".pages-dist");
const manifestPath = path.join(root, "deployment/media-manifest.json");
const archivePattern = /\.(?:zip|tgz|tar(?:\.(?:gz|bz2|xz))?|7z)$/i;
const MAX_ARTIFACT_BYTES = 900 * 1024 * 1024;

async function runNode(script, args) {
  await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [script, ...args], { cwd: root, stdio: "inherit" });
    child.once("error", reject);
    child.once("exit", (code, signal) => code === 0 ? resolve() : reject(new Error(`Media download failed (${signal || code}).`)));
  });
}

export function archiveUrls(manifest) {
  if (manifest.version !== 1 || !Array.isArray(manifest.assets))
    throw new Error("Pages build requires a version 1 media manifest.");
  const urls = new Map();
  for (const asset of manifest.assets) {
    if (typeof asset.url !== "string" || !asset.url.startsWith("https://"))
      throw new Error(`Media asset ${asset.name || "unknown"} lacks a public HTTPS URL.`);
    for (const target of asset.targets || []) {
      if (!target.path?.startsWith("frontend/public/")) continue;
      const relative = target.path.slice("frontend/public/".length);
      if (archivePattern.test(relative)) urls.set(relative, asset.url);
    }
  }
  return urls;
}

export function rewriteArchiveLinks(html, relativeHtmlPath, urls) {
  return html.replace(/\bhref\s*=\s*(["'])(.*?)\1/gi, (attribute, quote, value) => {
    const decoded = value.replace(/&amp;/gi, "&");
    const target = new URL(decoded, `https://pages-assets.invalid/${relativeHtmlPath.replaceAll(path.sep, "/")}`);
    if (target.origin !== "https://pages-assets.invalid") return attribute;
    const relative = decodeURIComponent(target.pathname).replace(/^\/+/, "");
    if (!archivePattern.test(relative)) return attribute;
    const url = urls.get(relative);
    if (!url) throw new Error(`Missing release URL for archive link ${relativeHtmlPath} → ${relative}.`);
    const escaped = url.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
    return `href=${quote}${escaped}${quote}`;
  });
}

async function transformHtml(directory, urls, base = directory) {
  let changed = 0;
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const filename = path.join(directory, entry.name);
    if (entry.isDirectory()) changed += await transformHtml(filename, urls, base);
    else if (entry.isFile() && entry.name.endsWith(".html")) {
      const original = await readFile(filename, "utf8");
      const transformed = rewriteArchiveLinks(original, path.relative(base, filename), urls);
      if (transformed !== original) { await writeFile(filename, transformed); changed++; }
    }
  }
  return changed;
}

export async function artifactSize(directory) {
  let bytes = 0;
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const filename = path.join(directory, entry.name);
    if ((await lstat(filename)).isSymbolicLink()) throw new Error(`Pages artifact contains a symbolic link: ${filename}`);
    if (entry.isDirectory()) bytes += await artifactSize(filename);
    else if (entry.isFile()) {
      if (archivePattern.test(entry.name)) throw new Error(`Archive was copied into the Pages artifact: ${filename}`);
      const info = await stat(filename);
      if (info.nlink > 1) throw new Error(`Pages artifact contains a hard link: ${filename}`);
      bytes += info.size;
    }
  }
  return bytes;
}

async function main() {
  if (!process.argv.includes("--skip-download"))
    await runNode(path.join(root, "scripts/download-assets.mjs"), ["--group", "public", "--omit-archives"]);
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  const urls = archiveUrls(manifest);
  const temporaryPublic = await mkdtemp(path.join(os.tmpdir(), "process-guide-pages-public-"));
  try {
    await cp(publicRoot, temporaryPublic, {
      recursive: true,
      dereference: true,
      filter: source => !archivePattern.test(source),
    });
    const transformed = await transformHtml(temporaryPublic, urls);
    process.env.VITE_BASE_PATH ||= "/universal-ai-proctor/";
    process.env.VITE_STATIC_HOSTING = "true";
    // Frontend dependencies have their own lockfile and installation directory.
    const require = createRequire(path.join(root, "frontend/package.json"));
    const { build } = await import(pathToFileURL(require.resolve("vite")).href);
    await build({
      root: path.join(root, "frontend"),
      configFile: path.join(root, "frontend/vite.config.ts"),
      mode: "pages",
      base: process.env.VITE_BASE_PATH,
      publicDir: temporaryPublic,
      build: { outDir: output, emptyOutDir: true, copyPublicDir: true },
    });
    // The preview uses hash routes; retaining a fallback also helps old links.
    await cp(path.join(output, "index.html"), path.join(output, "404.html"));
    await writeFile(path.join(output, ".nojekyll"), "");
    const bytes = await artifactSize(output);
    if (bytes >= MAX_ARTIFACT_BYTES)
      throw new Error(`Pages artifact is ${(bytes / 1024 ** 2).toFixed(1)} MiB, above the 900 MiB deployment budget.`);
    console.log(`Pages build ready: ${path.relative(root, output)} · ${(bytes / 1024 ** 2).toFixed(1)} MiB · ${transformed} archive-link page(s) rewritten.`);
  } finally {
    await rm(temporaryPublic, { recursive: true, force: true });
  }
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url)
  await main();
