import { strict as assert } from "node:assert";
import { test } from "node:test";
import { mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { archiveUrls, artifactSize, rewriteArchiveLinks } from "./build-pages.mjs";

test("archive downloads resolve by their exact public manifest destination", () => {
  const manifest = { version: 1, assets: [{
    name: "process-pairs.zip", url: "https://github.com/example/app/releases/download/v1/process-pairs.zip",
    targets: [{ path: "frontend/public/media/library/process-pairs.zip", groups: ["public"] }],
  }] };
  const urls = archiveUrls(manifest);
  const input = '<a href="process-pairs.zip?cache=1">Download pairs</a><a href="guidance.txt">Guide</a>';
  const output = rewriteArchiveLinks(input, "media/library/index.html", urls);
  assert.match(output, /href="https:\/\/github.com\/example\/app\/releases\/download\/v1\/process-pairs.zip"/);
  assert.match(output, /href="guidance.txt"/);
});

test("external archives remain unchanged and missing local release assets fail the build", () => {
  const input = '<a href="https://example.com/archive.zip">External</a>';
  assert.equal(rewriteArchiveLinks(input, "index.html", new Map()), input);
  assert.throws(() => rewriteArchiveLinks('<a href="missing.zip">Missing</a>', "index.html", new Map()), /Missing release URL/);
});

test("release URLs are safely escaped inside HTML attributes", () => {
  const output = rewriteArchiveLinks("<a href='assets.zip'>Pairs</a>", "media/index.html", new Map([
    ["media/assets.zip", "https://example.com/assets.zip?x=1&name='pairs'"],
  ]));
  assert.match(output, /&amp;name=&#39;pairs&#39;/);
});

test("the artifact rejects archives and symbolic links while measuring real file bytes", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "pages-artifact-check-"));
  try {
    await writeFile(path.join(directory, "index.html"), "hello");
    assert.equal(await artifactSize(directory), 5);
    await writeFile(path.join(directory, "download.zip"), "archive");
    await assert.rejects(artifactSize(directory), /Archive was copied/);
    await rm(path.join(directory, "download.zip"));
    await symlink(path.join(directory, "index.html"), path.join(directory, "linked.html"));
    await assert.rejects(artifactSize(directory), /symbolic link/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
