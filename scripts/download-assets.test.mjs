import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import path from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import { mkdtemp, writeFile, readFile, mkdir, rm, readdir, symlink } from "node:fs/promises";
import { downloadAssets } from "./download-assets.mjs";

const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const target = (name, groups = ["runtime"]) => ({ path: name, groups });
async function fixture(t, handler) {
  const root = await mkdtemp(path.join(tmpdir(), "process-guide-download-test-"));
  const server = http.createServer(handler);
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(async () => {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    await rm(root, { recursive: true, force: true });
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  return {
    root,
    asset(name, bytes, targets) { return { name, sha256: hash(bytes), size: bytes.length, url: `${base}/${name}`, targets }; },
    async run(assets, options = {}) {
      const manifestPath = path.join(root, "manifest.json");
      await writeFile(manifestPath, JSON.stringify({ version: 1, release: "test", assets }));
      return downloadAssets({ root, manifestPath, ...options });
    },
  };
}

test("one streamed asset populates multiple destinations and is reused without network", async t => {
  const bytes = Buffer.alloc(90_000, 7); let requests = 0;
  const f = await fixture(t, (_req, res) => { requests++; res.write(bytes.subarray(0, 30_000)); res.end(bytes.subarray(30_000)); });
  const a = f.asset("film.mp4", bytes, [target("sample-videos/film.mp4"), target("frontend/public/film.mp4")]);
  const first = await f.run([a]);
  assert.equal(requests, 1); assert.equal(first.downloaded, 1); assert.equal(first.copied, 2);
  assert.deepEqual(await readFile(path.join(f.root, "sample-videos/film.mp4")), bytes);
  assert.deepEqual(await readFile(path.join(f.root, "frontend/public/film.mp4")), bytes);
  const second = await f.run([a]);
  assert.equal(requests, 1); assert.equal(second.reused, 1); assert.equal(second.copied, 0);
});

test("group selection and archive omission preserve runtime/public/reproduction separation", async t => {
  const payloads = { "runtime.mp4": Buffer.from("runtime"), "public.mp4": Buffer.from("public"), "source.zip": Buffer.from("archive") };
  const requested = [];
  const f = await fixture(t, (req, res) => { requested.push(req.url); res.end(payloads[req.url.slice(1)]); });
  const assets = [
    f.asset("runtime.mp4", payloads["runtime.mp4"], [target("runtime/video.mp4")]),
    f.asset("public.mp4", payloads["public.mp4"], [target("public/video.mp4", ["public"])]),
    f.asset("source.zip", payloads["source.zip"], [target("public/archive.zip", ["public"]), target("sources/archive.zip", ["sources"])]),
  ];
  await f.run(assets);
  assert.deepEqual(requested, ["/runtime.mp4"]);
  await f.run(assets, { groups: ["public"], omitArchives: true });
  assert.deepEqual(requested, ["/runtime.mp4", "/public.mp4"]);
  await assert.rejects(readFile(path.join(f.root, "public/archive.zip")), { code: "ENOENT" });
  await f.run(assets, { all: true });
  assert.deepEqual(requested, ["/runtime.mp4", "/public.mp4", "/source.zip"]);
  assert.deepEqual(await readFile(path.join(f.root, "sources/archive.zip")), payloads["source.zip"]);
});

test("matching existing content repairs a missing target without downloading", async t => {
  const bytes = Buffer.from("existing verified content"); let requests = 0;
  const f = await fixture(t, (_req, res) => { requests++; res.end(bytes); });
  await mkdir(path.join(f.root, "existing")); await writeFile(path.join(f.root, "existing/film.mp4"), bytes);
  const summary = await f.run([f.asset("film.mp4", bytes, [target("existing/film.mp4"), target("repaired/film.mp4")])]);
  assert.equal(requests, 0); assert.equal(summary.reused, 1); assert.equal(summary.copied, 1);
  assert.deepEqual(await readFile(path.join(f.root, "repaired/film.mp4")), bytes);
});

test("hash, excessive size and short-body failures leave previous targets untouched", async t => {
  const expected = Buffer.from("correct"); let returned = Buffer.from("corrupt");
  const f = await fixture(t, (_req, res) => res.end(returned));
  const a = f.asset("film.mp4", expected, [target("film.mp4")]);
  await writeFile(path.join(f.root, "film.mp4"), "previous");
  for (const body of [Buffer.from("corrupt"), Buffer.from("far too many bytes"), Buffer.from("tiny")]) {
    returned = body;
    await assert.rejects(f.run([a]), /manifest size\/SHA256|exceeds the manifest size/);
    assert.equal(await readFile(path.join(f.root, "film.mp4"), "utf8"), "previous");
    assert.deepEqual((await readdir(f.root)).sort(), ["film.mp4", "manifest.json"]);
  }
});

test("traversal, absolute paths, ambiguous separators and conflicting outputs fail before requests", async t => {
  const bytes = Buffer.from("sample"); let requests = 0;
  const f = await fixture(t, (_req, res) => { requests++; res.end(bytes); });
  for (const value of ["../escape.mp4", "/absolute.mp4", "a/../../escape.mp4", "a\\escape.mp4", "C:/escape.mp4", "a//film.mp4", "./film.mp4", "film\0.mp4"])
    await assert.rejects(f.run([f.asset("film.mp4", bytes, [target(value)])]), /Unsafe media target path/);
  const a = f.asset("a.mp4", bytes, [target("same.mp4")]);
  const b = f.asset("b.mp4", Buffer.from("other"), [target("same.mp4")]);
  await assert.rejects(f.run([a, b]), /Conflicting media assets/);
  assert.equal(requests, 0);
});

test("symlink destinations cannot escape the selected root", async t => {
  const bytes = Buffer.from("sample"); let requests = 0;
  const f = await fixture(t, (_req, res) => { requests++; res.end(bytes); });
  const outside = await mkdtemp(path.join(tmpdir(), "process-guide-download-outside-"));
  t.after(() => rm(outside, { recursive: true, force: true }));
  await symlink(outside, path.join(f.root, "linked"), "dir");
  await assert.rejects(f.run([f.asset("film.mp4", bytes, [target("linked/film.mp4")])]), /Symlink media target/);
  assert.deepEqual(await readdir(outside), []); assert.equal(requests, 0);
});

test("hanging response is aborted at the deadline without publishing a partial asset", async t => {
  const bytes = Buffer.alloc(128, 1);
  const f = await fixture(t, (_req, res) => { res.writeHead(200); res.write(bytes.subarray(0, 1)); });
  await assert.rejects(f.run([f.asset("film.mp4", bytes, [target("film.mp4")])], { timeoutMs: 50 }), /abort|timeout/i);
  await assert.rejects(readFile(path.join(f.root, "film.mp4")), { code: "ENOENT" });
  assert.deepEqual(await readdir(f.root), ["manifest.json"]);
});

test("distinct transfers are bounded to two active downloads and identical content is deduplicated", async t => {
  let active = 0, peak = 0, requests = 0;
  const bodies = new Map(Array.from({ length: 4 }, (_, i) => [`${i}.mp4`, Buffer.from(`movie-${i}`)]));
  const f = await fixture(t, (req, res) => {
    requests++; peak = Math.max(peak, ++active); res.once("close", () => active--);
    setTimeout(() => res.end(bodies.get(req.url.slice(1))), 40);
  });
  const assets = [...bodies].map(([name, bytes]) => f.asset(name, bytes, [target(`videos/${name}`)]));
  assets.push(f.asset("duplicate.mp4", bodies.get("0.mp4"), [target("other/duplicate.mp4")]));
  const summary = await f.run(assets);
  assert.equal(peak, 2); assert.equal(requests, 4); assert.equal(summary.assets, 4);
  assert.deepEqual(await readFile(path.join(f.root, "other/duplicate.mp4")), bodies.get("0.mp4"));
});
