import { expect, test, type Locator, type Page, type TestInfo } from "@playwright/test";
import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { VideoSummaryJob } from "../../backend/src/domain/videoSummary";

let directory = "", clip = "";
const reference = ["Principles: SYNTHETIC VIDEO SUMMARY QA. Instructions are expectations, not observations.", "Step 1: Observe test pattern", "Actions: Review generated pixels.", "Criteria: Visible pattern retained; Hidden physical measurements remain unknown."].join("\n");
test.beforeAll(async () => {
  directory = await fs.mkdtemp(path.join(os.tmpdir(), "cueveris-video-summary-browser-")); clip = path.join(directory, "synthetic-pattern-18s.mp4");
  execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "testsrc2=size=640x360:rate=12", "-t", "18", "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", "-y", clip]);
});
test.afterAll(async () => { if (directory) await fs.rm(directory, { recursive: true, force: true }); });

async function headers(page: Page) { return { "X-Guidance-Session": (await page.evaluate(() => sessionStorage.getItem("process-guide-session")))! }; }
async function qa(page: Page, route: string, data?: unknown) {
  const response = data === undefined ? await page.request.get(`/__video_summary_qa/${route}`, { headers: await headers(page) }) : await page.request.post(`/__video_summary_qa/${route}`, { headers: await headers(page), data });
  expect(response.ok()).toBe(true); return response.json();
}
async function job(page: Page, id?: string): Promise<VideoSummaryJob | null> {
  const response = await page.request.get(`/api/video-summary/jobs/${id || "current"}`, { headers: await headers(page) });
  expect(response.ok()).toBe(true); return (await response.json()).job;
}
async function terminal(page: Page, id: string, status: VideoSummaryJob["status"] = "complete") {
  await expect.poll(async () => (await job(page, id))?.status, { timeout: 60000 }).toBe(status);
  return (await job(page, id))!;
}
async function pause(page: Page) {
  const button = page.getByRole("button", { name: "Pause guidance", exact: true });
  if (await button.isVisible()) await button.click();
  else {
    const sources = page.getByRole("button", { name: "Sources and setup", exact: true });
    if (await sources.isVisible()) {
      await sources.click(); if (await button.isVisible()) await button.click();
      await page.getByRole("button", { name: "Close sources", exact: true }).click();
    }
  }
  await page.locator(".video-canvas video").evaluate((video: HTMLVideoElement) => video.pause());
}
async function setup(page: Page, large = false, withoutText = false) {
  await page.goto("/");
  const text = large ? `${reference}\n${"QA source text is not an instruction to fabricate evidence. ".repeat(6000)}\nLARGE_REFERENCE_END` : reference;
  if (!withoutText) {
    await page.getByTestId("intro-document-input").setInputFiles({ name: "Synthetic recap expectations.txt", mimeType: "text/plain", buffer: Buffer.from(text) });
    await expect(page.getByText("Synthetic recap expectations.txt · 1 steps extracted")).toBeVisible();
  }
  await page.getByTestId("intro-video-input").setInputFiles(clip);
  await page.getByRole("button", { name: "Open workspace", exact: true }).click();
  await expect.poll(() => page.locator(".video-canvas video").evaluate((video: HTMLVideoElement) => video.readyState)).toBeGreaterThanOrEqual(2);
  await pause(page);
  await qa(page, "control", { mode: "valid", domain: "manufacturing", delay_ms: 0, tts_delay_ms: 0, clear_audit: true });
}
async function recap(page: Page) {
  await page.getByTestId("video-recap-open").click();
  const dialog = page.getByTestId("video-recap-dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Start video recap", exact: true })).toBeEnabled();
  return dialog;
}
async function start(page: Page, dialog: Locator, domain?: string) {
  if (domain) await dialog.getByLabel(/^Process domain/).selectOption(domain);
  const response = page.waitForResponse(response => new URL(response.url()).pathname === "/api/video-summary/jobs" && response.request().method() === "POST");
  await dialog.getByRole("button", { name: "Start video recap", exact: true }).click();
  const submitted = await response; expect(submitted.status()).toBe(202);
  return (await submitted.json()).job as VideoSummaryJob;
}
async function download(page: Page, dialog: Locator) {
  const waiting = page.waitForEvent("download");
  await expect(dialog.getByRole("button", { name: "Download recap JSON", exact: true })).toBeEnabled();
  await dialog.getByRole("button", { name: "Download recap JSON", exact: true }).click();
  const result = await waiting, file = await result.path(); expect(file).toBeTruthy();
  return JSON.parse(await fs.readFile(file!, "utf8")) as VideoSummaryJob;
}
async function fits(page: Page, dialog: Locator) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  expect(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
  for (const region of [".recap-header", ".recap-body", ".recap-footer"]) {
    const geometry = await dialog.locator(region).evaluate(element => ({ client: element.clientWidth, scroll: element.scrollWidth }));
    expect(geometry.scroll, `${region} has no horizontal overflow`).toBeLessThanOrEqual(geometry.client + 1);
  }
  await expect(dialog.getByRole("button", { name: "Close", exact: true })).toBeInViewport();
}
async function fullVisible(dialog: Locator, target: Locator) {
  await target.scrollIntoViewIfNeeded();
  await expect(target).toBeInViewport();
  const container = await dialog.boundingBox(), element = await target.boundingBox();
  expect(container).not.toBeNull(); expect(element).not.toBeNull();
  expect(element!.x).toBeGreaterThanOrEqual(container!.x - 1);
  expect(element!.x + element!.width).toBeLessThanOrEqual(container!.x + container!.width + 1);
  expect(element!.y).toBeGreaterThanOrEqual(container!.y - 1);
  expect(element!.y + element!.height).toBeLessThanOrEqual(container!.y + container!.height + 1);
  await expect(dialog.getByRole("button", { name: "Close", exact: true })).toBeInViewport();
}
async function capture(page: Page, info: TestInfo, name: string) {
  const file = info.outputPath(name); await page.screenshot({ path: file, fullPage: true, animations: "disabled" });
  await info.attach(name, { path: file, contentType: "image/png" });
}
async function accessibility(page: Page, info: TestInfo, name: string) {
  const script = process.env.VIDEO_SUMMARY_QA_AXE;
  if (!script) {
    await info.attach(`${name}-accessibility.json`, { body: JSON.stringify({ automatedAxe: false, scope: "Native labeled controls, dialog title, progress name, keyboard activation/Escape and overflow assertions only. No full accessibility audit claimed." }), contentType: "application/json" });
    return;
  }
  await page.addScriptTag({ path: script });
  const result = await page.evaluate(async () => {
    const axe = (window as unknown as { axe: { run: (context: unknown, options: unknown) => Promise<{ violations: unknown[]; incomplete: unknown[]; passes: unknown[]; testEngine: unknown; testRunner: unknown }> } }).axe;
    const result = await axe.run({ include: [[".video-recap-dialog"]] }, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21aa"] } });
    return { violations: result.violations, incomplete: result.incomplete, passingRules: result.passes.length, testEngine: result.testEngine, testRunner: result.testRunner };
  });
  await info.attach(`${name}-accessibility.json`, { body: JSON.stringify(result, null, 2), contentType: "application/json" });
  expect(result.violations, "Scoped WCAG2A/AA/2.1AA axe findings; incomplete checks remain in the artifact for human review").toEqual([]);
}
async function contrastPairs(dialog: Locator, info: TestInfo) {
  const pairs = await dialog.evaluate(element => {
    const rgba = (color: string): [number, number, number, number] => {
      const values = color.match(/[\d.]+/g)?.map(Number);
      if (!values || values.length < 3 || !/^rgba?\(/.test(color)) throw new Error(`Unsupported computed color: ${color}`);
      return [values[0], values[1], values[2], values[3] ?? 1];
    };
    const blend = (foreground: number[], background: number[]) => foreground.slice(0, 3).map((value, i) => value * foreground[3] + background[i] * (1 - foreground[3]));
    const luminance = (rgb: number[]) => rgb.map(value => { const s = value / 255; return s <= .04045 ? s / 12.92 : ((s + .055) / 1.055) ** 2.4; }).reduce((sum, value, i) => sum + value * [.2126, .7152, .0722][i], 0);
    const card = rgba(getComputedStyle(element).backgroundColor);
    if (card[3] !== 1) throw new Error("Recap background is not opaque; do not guess its contrast.");
    const probes = [
      { name: "Main dialog text on card", selector: ".recap-header h2", surface: element },
      { name: "Muted paragraph on card", selector: ".recap-overview > p", surface: element },
      { name: "Accent eyebrow on card", selector: ".recap-header .recap-eyebrow", surface: element },
      { name: "Metric paragraph on composited metric surface", selector: ".recap-metrics > article p:not(.recap-metric-value)", surface: element.querySelector(".recap-metrics > article")! },
    ];
    return probes.map(probe => {
      const target = element.querySelector(probe.selector); if (!target || !probe.surface) throw new Error(`Missing contrast probe: ${probe.name}`);
      const background = probe.surface === element ? card.slice(0, 3) : blend(rgba(getComputedStyle(probe.surface).backgroundColor), card);
      const foreground = blend(rgba(getComputedStyle(target).color), background);
      const a = luminance(foreground), b = luminance(background);
      return { name: probe.name, foreground, background, ratio: (Math.max(a, b) + .05) / (Math.min(a, b) + .05), minimum: 4.5 };
    });
  });
  await info.attach("computed-contrast-pairs.json", { body: JSON.stringify({ scope: "Four explicit CSS foreground/surface pairs only; this does not replace human review of clipped, overlapping or other states.", pairs }, null, 2), contentType: "application/json" });
  for (const pair of pairs) expect(pair.ratio, pair.name).toBeGreaterThanOrEqual(pair.minimum);
}
function integrity(result: VideoSummaryJob) {
  expect(result.provenance.simulated).toBe(true);
  expect(result.provenance.visual_analysis).toBe("sampled_frames");
  expect(result.source).toMatchObject({ duration_s: 18, width: 640, height: 360 });
  const metric = result.metrics.find(metric => metric.id === "critical_domain_metric")!;
  expect(metric).toMatchObject({ value: null, status: "unavailable" }); expect(metric.explanation.length).toBeGreaterThan(20);
  for (const window of result.windows) for (const finding of window.events) {
    expect(finding.start_s).toBeGreaterThanOrEqual(window.start_s); expect(finding.end_s).toBeLessThanOrEqual(window.end_s);
    expect(finding.frame_refs.length + finding.transcript_refs.length).toBeGreaterThan(0);
    expect(finding.frame_refs.every(ref => window.sampled_frames.some(frame => frame.id === ref))).toBe(true);
    expect(finding.transcript_refs.every(ref => window.transcript.some(segment => segment.id === ref))).toBe(true);
    expect(finding.metric_ids.every(id => result.metric_plan.some(metric => metric.id === id))).toBe(true);
  }
}

type BrowserDiagnostics = { pageErrors: string[]; console: { type: string; text: string; url: string; expected: boolean; expectedReason: string | null }[]; httpErrors: { status: number; url: string }[]; failedRequests: { method: string; url: string; error: string; expected: boolean; expectedReason: string | null }[] };
const diagnostics = new WeakMap<Page, BrowserDiagnostics>();
test.beforeEach(async ({ page }) => {
  const messages: BrowserDiagnostics = { pageErrors: [], console: [], httpErrors: [], failedRequests: [] }; diagnostics.set(page, messages);
  page.on("pageerror", error => messages.pageErrors.push(error.message));
  page.on("console", message => {
    if (!["error", "warning"].includes(message.type())) return;
    const expected = page.context().browser()?.browserType().name() === "webkit" && message.text() === 'Viewport argument key "interactive-widget" not recognized and ignored.';
    messages.console.push({ type: message.type(), text: message.text(), url: message.location().url, expected, expectedReason: expected ? "WebKit ignores the Chrome viewport directive; the app uses its visual-viewport fallback. Native message is retained, not hidden." : null });
  });
  page.on("response", response => { if (response.status() >= 400) messages.httpErrors.push({ status: response.status(), url: response.url() }); });
  page.on("requestfailed", request => {
    const error = request.failure()?.errorText || "Unknown request failure";
    // The production hooks abort obsolete requests on mode/source/seek changes.
    // Retain these records rather than hiding them; other failures still fail QA.
    const aborted = /abort|cancel/i.test(error), url = new URL(request.url());
    const obsoleteHook = aborted && (/^\/api\/(?:video-summary\/(?:plan|jobs)|source|reference|tts|analyze)/.test(url.pathname) || url.pathname === "/api/guidance/analyze");
    const nativeMedia = aborted && url.protocol === "blob:" && request.method() === "GET" && request.resourceType() === "media";
    messages.failedRequests.push({ method: request.method(), url: request.url(), error, expected: obsoleteHook || nativeMedia, expectedReason: obsoleteHook ? "Production hook cancels obsolete requests after input/playback changes." : nativeMedia ? "Native media cancels blob reads on seek, source replacement or audio stop; decoder/playback assertions remain active." : null });
  });
});
test.afterEach(async ({ page }, info) => {
  const messages = diagnostics.get(page)!;
  await info.attach("browser-diagnostics.json", { body: JSON.stringify(messages, null, 2), contentType: "application/json" });
  expect(messages.pageErrors).toEqual([]);
  expect(messages.httpErrors).toEqual([]);
  expect(messages.failedRequests.filter(record => !record.expected)).toEqual([]);
  expect(messages.console.filter(record => record.type === "error" && !record.expected)).toEqual([]);
});

for (const domain of ["surgery", "construction", "manufacturing", "dance", "meeting"]) {
  test(`explicit ${domain} domain keeps unknown measurements visible and immutable JSON scoped`, async ({ page }) => {
    await setup(page); const before = await qa(page, "audit");
    const dialog = await recap(page); expect((await qa(page, "audit")).calls).toHaveLength(0);
    if (domain === "meeting") await dialog.getByLabel("Include video audio", { exact: true }).check();
    const submitted = await start(page, dialog, domain); const result = await terminal(page, submitted.id);
    integrity(result); expect(result.domain?.key).toBe(domain); expect(result.domain?.basis).toBe("operator");
    if (domain !== "manufacturing") expect(result.domain?.conflict).toContain("Manufacturing");
    if (domain === "meeting") { expect(result.audio.status).toBe("no_audio"); expect(result.windows.flatMap(window => window.transcript)).toHaveLength(0); }
    const domainMetrics = result.metrics.filter(metric => metric.id.startsWith(`${domain}_`));
    expect(domainMetrics).toHaveLength(2);
    expect(domainMetrics.at(-1)).toMatchObject({ value: null, status: "unavailable" });
    if (domain !== "meeting") expect(domainMetrics[0]).toMatchObject({ value: 3, status: "estimated" });
    else expect(domainMetrics.every(metric => metric.value === null && metric.status === "unavailable")).toBe(true);
    const saved = await download(page, dialog); expect(saved).toEqual(result);
    expect(saved.metrics.find(metric => metric.id === "source_duration")?.value).toBe(18);
    expect(saved.metrics.find(metric => metric.id === "analyzed_window_coverage")?.value).toBe(18);
    const after = await qa(page, "audit"); expect(after.input.workflow).toEqual(before.input.workflow); expect(after.input.votes).toEqual(before.input.votes);
    expect(after.calls.filter((call: { stage: string }) => call.stage === "window")).toHaveLength(3);
    expect(after.calls.filter((call: { stage: string }) => call.stage === "window").every((call: { frame_count: number; frame_hashes: string[] }) => call.frame_count === 9 && call.frame_hashes.length === 9)).toBe(true);
    expect(after.real_provider_calls).toBe(0);
  });
}

test("meeting decisions cite explicit simulated speech and preserve unavailable adoption or follow-up metrics", async ({ page }) => {
  await setup(page); await qa(page, "control", { mode: "meeting_audio", domain: "meeting" });
  const dialog = await recap(page); await dialog.getByLabel("Include video audio", { exact: true }).check();
  const submitted = await start(page, dialog, "meeting"), result = await terminal(page, submitted.id);
  integrity(result); expect(result.audio.status).toBe("available");
  expect(result.metrics.find(metric => metric.id === "meeting_decision")).toMatchObject({ value: 3, status: "estimated" });
  expect(result.metrics.find(metric => metric.id === "meeting_action_item")).toMatchObject({ value: null, status: "unavailable" });
  for (const window of result.windows) {
    expect(window.events[0]).toMatchObject({ kind: "decision", frame_refs: [], metric_ids: ["meeting_decision"] });
    expect(window.events[0]!.transcript_refs).toEqual([window.transcript[0]!.id]);
    expect(window.transcript[0]!.text).toContain("Simulated QA speech");
  }
});

test("balanced planning changes real window size without starting model work and automatic domain inference remains explicit", async ({ page }) => {
  await setup(page); await qa(page, "control", { domain: "dance" });
  const dialog = await recap(page);
  await dialog.getByLabel(/^Analysis detail/).selectOption("balanced");
  await expect(dialog).toContainText("2 windows · up to 6 frames per window");
  expect((await qa(page, "audit")).calls).toHaveLength(0);
  const submitted = await start(page, dialog), result = await terminal(page, submitted.id);
  integrity(result); expect(result.domain).toMatchObject({ key: "dance", basis: "both" });
  expect(result.progress).toMatchObject({ total_windows: 2, completed_windows: 2, failed_windows: 0, sampled_frames: 12 });
  expect(result.windows.map(window => [window.start_s, window.end_s])).toEqual([[0, 12], [12, 18]]);
  expect(result.metrics.find(metric => metric.id === "analyzed_window_coverage")?.value).toBe(18);
});
test("a completed recap without TXT keeps its input snapshot when uploaded guidance is started afterward", async ({ page }) => {
  await setup(page, false, true); const before = await qa(page, "audit"); expect(before.input.workflow.steps).toEqual([]);
  const dialog = await recap(page), submitted = await start(page, dialog), result = await terminal(page, submitted.id);
  expect(result.reference.name).toBe("No reference document"); expect(result.metric_plan.some(metric => metric.id === "document_criteria")).toBe(false);
  await expect(dialog).toContainText("Simulated synthetic-video recap");
  await dialog.getByRole("button", { name: "Close", exact: true }).click(); await expect(dialog).not.toBeVisible();
  const startGuidance = page.getByRole("button", { name: "Start guidance", exact: true });
  if (!(await startGuidance.isVisible())) await page.getByRole("button", { name: "Sources and setup", exact: true }).click();
  await startGuidance.click();
  await expect.poll(() => page.locator(".video-canvas video").evaluate((video: HTMLVideoElement) => video.paused)).toBe(false);
  await expect.poll(() => page.locator(".video-canvas video").evaluate((video: HTMLVideoElement) => video.currentTime)).toBeGreaterThan(1.5);
  const after = await qa(page, "audit"); expect(after.interactive_calls).toBe(0); expect(after.input.workflow).toEqual(before.input.workflow);
  expect((await job(page))?.id).toBe(result.id);
});

test("Resume guidance releases recap ownership only after the explicit action and retains the pinned JSON", async ({ page }) => {
  await setup(page);
  const dialog = await recap(page), submitted = await start(page, dialog), result = await terminal(page, submitted.id);
  await expect(dialog).toContainText("Simulated synthetic-video recap");
  await dialog.getByLabel("Narrate during playback", { exact: true }).check();
  await dialog.getByRole("button", { name: "Close", exact: true }).click(); await expect(dialog).not.toBeVisible();
  const before = await qa(page, "audit");
  const startGuidance = page.getByRole("button", { name: "Start guidance", exact: true });
  if (!(await startGuidance.isVisible())) await page.getByRole("button", { name: "Sources and setup", exact: true }).click();
  await startGuidance.click();
  await expect.poll(() => page.locator(".video-canvas video").evaluate((video: HTMLVideoElement) => video.paused)).toBe(false);
  await expect.poll(() => page.locator(".video-canvas video").evaluate((video: HTMLVideoElement) => video.currentTime)).toBeGreaterThan(1.2);
  expect((await qa(page, "audit")).interactive_calls).toBe(0);
  expect((await qa(page, "audit")).input.votes).toEqual(before.input.votes);
  await page.getByTestId("video-recap-open").click();
  await dialog.getByRole("button", { name: "Resume guidance", exact: true }).click();
  await expect(dialog.getByLabel("Narrate during playback", { exact: true })).not.toBeChecked();
  await expect.poll(async () => (await qa(page, "audit")).interactive_calls).toBeGreaterThan(0);
  expect(await download(page, dialog)).toEqual(result);
  await dialog.getByRole("button", { name: "Close", exact: true }).click(); await expect(dialog).not.toBeVisible();
  const released = (await qa(page, "audit")).interactive_calls;
  await page.getByTestId("video-recap-open").click(); await expect(dialog).toContainText("Guidance is available again");
  await expect(dialog.getByRole("button", { name: "Resume guidance", exact: true })).toHaveCount(0);
  await expect.poll(async () => (await qa(page, "audit")).interactive_calls).toBeGreaterThan(released);
  expect(await download(page, dialog)).toEqual(result);
});

test("duplicate episode evidence is retained for audit while totals use unique episodes and interval unions", async ({ page }) => {
  await setup(page); await qa(page, "control", { mode: "duplicate" });
  const dialog = await recap(page), submitted = await start(page, dialog), result = await terminal(page, submitted.id);
  integrity(result); expect(result.windows.flatMap(window => window.events)).toHaveLength(6);
  expect(result.metrics.find(metric => metric.id === "retained_events")?.value).toBe(3);
  expect(result.metrics.find(metric => metric.id === "observed_span")?.value).toBeLessThanOrEqual(18);
});
test("detailed verification can remove primary findings without converting missing process evidence into a measured zero", async ({ page }) => {
  await setup(page); await qa(page, "control", { mode: "verification_rejects" });
  const dialog = await recap(page), submitted = await start(page, dialog), result = await terminal(page, submitted.id);
  integrity(result); expect(result.windows.flatMap(window => window.events)).toEqual([]);
  expect(result.windows.every(window => window.narration === "")).toBe(true);
  expect(result.metrics.find(metric => metric.id === "manufacturing_assembly")).toMatchObject({ value: null, status: "unavailable" });
  expect(result.metrics.find(metric => metric.id === "analyzed_window_coverage")?.value).toBe(18);
  const audit = await qa(page, "audit"); expect(audit.calls.filter((call: { stage: string }) => call.stage === "verification")).toHaveLength(3);
});
test("partial result discloses failed intervals and retries only the failed window", async ({ page }) => {
  await setup(page); await qa(page, "control", { mode: "partial" });
  const dialog = await recap(page), submitted = await start(page, dialog), partial = await terminal(page, submitted.id, "partial");
  expect(partial.progress).toMatchObject({ completed_windows: 2, failed_windows: 1 });
  expect(partial.windows[1]).toMatchObject({ status: "failed", start_s: 6, end_s: 12, events: [] });
  expect(partial.metrics.find(metric => metric.id === "analyzed_window_coverage")?.value).toBe(12);
  const accepted = partial.windows.filter(window => window.status === "complete");
  await expect(dialog).toContainText(/partial/i); await download(page, dialog);
  await qa(page, "control", { mode: "valid", clear_audit: true });
  const response = page.waitForResponse(response => new URL(response.url()).pathname === `/api/video-summary/jobs/${submitted.id}/retry`);
  await dialog.getByRole("button", { name: "Retry failed windows", exact: true }).click();
  const resumed = (await (await response).json()).job as VideoSummaryJob;
  expect(resumed.id).not.toBe(submitted.id);
  const retried = await terminal(page, resumed.id); expect(retried.windows.filter(window => accepted.some(previous => previous.id === window.id))).toEqual(accepted);
  expect(await job(page, submitted.id)).toEqual(partial);
  const originalFile = await page.request.get(`/api/video-summary/jobs/${submitted.id}/report.json`, { headers: await headers(page) });
  expect(await originalFile.json()).toEqual(partial);
  expect((await qa(page, "audit")).calls.filter((call: { stage: string }) => call.stage === "window").map((call: { window: string }) => call.window)).toEqual([partial.windows[1]!.id]);
});
for (const mode of ["invalid_refs", "invalid_time", "foreign_metric", "foreign_finding_metric"]) test(`${mode} model output cannot become accepted evidence or inflate coverage`, async ({ page }) => {
  await setup(page); await qa(page, "control", { mode });
  const dialog = await recap(page), submitted = await start(page, dialog), result = await terminal(page, submitted.id, "partial");
  integrity(result); expect(result.windows[1]?.events).toEqual([]); expect(result.progress.failed_windows).toBe(1);
  expect(result.metrics.find(metric => metric.id === "analyzed_window_coverage")?.value).toBe(12);
  expect(JSON.stringify(result.windows.flatMap(window => window.events))).not.toContain("foreign-source-frame");
});
test("cancel aborts the active model request and does not publish a completed download", async ({ page }) => {
  await setup(page); await qa(page, "control", { mode: "slow", delay_ms: 3000 });
  const dialog = await recap(page), submitted = await start(page, dialog);
  await expect.poll(async () => (await qa(page, "audit")).calls.length).toBeGreaterThan(0);
  await dialog.getByRole("button", { name: "Cancel video recap", exact: true }).click();
  const result = await terminal(page, submitted.id, "cancelled"); expect(result.summary).toBeNull();
  await expect.poll(async () => (await qa(page, "audit")).calls.some((call: { outcome: string }) => call.outcome === "cancelled")).toBe(true);
  const file = await page.request.get(`/api/video-summary/jobs/${submitted.id}/report.json`, { headers: await headers(page) }); expect(file.status()).toBe(409);
});
test("changing instructions invalidates the old job without mapping reused step IDs into the new input", async ({ page }) => {
  await setup(page); await qa(page, "control", { mode: "slow", delay_ms: 3000 });
  const dialog = await recap(page), submitted = await start(page, dialog);
  await expect.poll(async () => (await qa(page, "audit")).calls.length).toBeGreaterThan(0);
  const response = await page.evaluate(async text => {
    const response = await fetch("/api/reference/document", { method: "PUT", headers: { "Content-Type": "application/json", "X-Guidance-Session": sessionStorage.getItem("process-guide-session")! }, body: JSON.stringify({ text }) });
    window.dispatchEvent(new CustomEvent("guidance-reference-updated")); return response.status;
  }, "Step 1: A completely different workflow\nActions: Inspect other source.\nCriteria: Do not reuse prior evidence.");
  expect(response).toBe(200); await terminal(page, submitted.id, "stale"); expect(await job(page)).toBeNull();
  const retry = await page.request.post(`/api/video-summary/jobs/${submitted.id}/retry`, { headers: await headers(page), data: {} }); expect(retry.status()).toBe(409);
  await expect(dialog).not.toContainText("Simulated synthetic-video recap");
});
test("large TXT stays intact while model context stays bounded and saved JSON survives later instruction edits", async ({ page }) => {
  await setup(page, true); const before = await qa(page, "audit"); expect(before.input.reference_chars).toBeGreaterThan(300000);
  const dialog = await recap(page), submitted = await start(page, dialog), result = await terminal(page, submitted.id);
  const saved = await download(page, dialog); expect(saved).toEqual(result);
  expect((await qa(page, "audit")).calls.every((call: { prompt_chars: number }) => call.prompt_chars < 40000)).toBe(true);
  const referenceResponse = await page.request.get("/api/reference/document", { headers: await headers(page) }); expect((await referenceResponse.json()).text).toContain("LARGE_REFERENCE_END");
  await page.request.put("/api/reference/document", { headers: await headers(page), data: { text: "Step 1: New reference\nCriteria: New criterion." } });
  const exported = await page.request.get(`/api/video-summary/jobs/${submitted.id}/report.json`, { headers: await headers(page) }); expect(exported.ok()).toBe(true); expect(await exported.json()).toEqual(saved);
});

test("source replacement cancels active analysis and prevents the previous job from becoming current", async ({ page }) => {
  await setup(page); await qa(page, "control", { mode: "slow", delay_ms: 3000 });
  const dialog = await recap(page), submitted = await start(page, dialog);
  await expect.poll(async () => (await qa(page, "audit")).calls.length).toBeGreaterThan(0);
  await dialog.getByRole("button", { name: "Close", exact: true }).click(); await expect(dialog).not.toBeVisible();
  await page.getByTestId("workspace-video-input").setInputFiles({ name: "Replacement synthetic source.mp4", mimeType: "video/mp4", buffer: await fs.readFile(clip) });
  await expect.poll(async () => (await qa(page, "audit")).input.source_id).not.toBe(submitted.source.id);
  await terminal(page, submitted.id, "stale"); expect(await job(page)).toBeNull();
  await expect.poll(async () => (await qa(page, "audit")).calls.some((call: { outcome: string }) => call.outcome === "cancelled")).toBe(true);
  const retry = await page.request.post(`/api/video-summary/jobs/${submitted.id}/retry`, { headers: await headers(page), data: {} }); expect(retry.status()).toBe(409);
});

test("video ending waits for actual analysis completion before opening the recap", async ({ page }) => {
  await setup(page); await qa(page, "control", { mode: "slow", delay_ms: 1000 });
  const dialog = await recap(page), submitted = await start(page, dialog);
  await dialog.getByRole("button", { name: "Close", exact: true }).click(); await expect(dialog).not.toBeVisible();
  const video = page.locator(".video-canvas video");
  await video.evaluate((element: HTMLVideoElement) => { element.currentTime = element.duration - 0.25; });
  await page.getByRole("button", { name: "Play video", exact: true }).click();
  await expect.poll(() => video.evaluate((element: HTMLVideoElement) => element.ended)).toBe(true);
  expect(["planning", "analyzing", "synthesizing", "queued"]).toContain((await job(page, submitted.id))!.status);
  await expect(dialog).not.toBeVisible();
  await terminal(page, submitted.id); await expect(dialog).toBeVisible(); await expect(dialog).toContainText("Simulated synthetic-video recap");
});

async function monitorNativeAudio(page: Page) {
  await page.addInitScript(() => {
    const entries: { src: string; time: number; at: number }[] = [];
    (window as unknown as { summaryQaAudio: typeof entries }).summaryQaAudio = entries;
    const original = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function () {
      if (this instanceof HTMLAudioElement) this.addEventListener("playing", () => entries.push({ src: this.currentSrc || this.src, time: document.querySelector<HTMLVideoElement>(".video-canvas video")?.currentTime || 0, at: performance.now() }), { once: true });
      return original.call(this);
    };
    const utterances: { text: string; time: number }[] = [];
    (window as unknown as { summaryQaFallbackSpeech: typeof utterances }).summaryQaFallbackSpeech = utterances;
    if (window.speechSynthesis) {
      const speak = speechSynthesis.speak.bind(speechSynthesis);
      speechSynthesis.speak = utterance => { utterances.push({ text: utterance.text, time: document.querySelector<HTMLVideoElement>(".video-canvas video")?.currentTime || 0 }); speak(utterance); };
    }
  });
}
async function audio(page: Page) { return page.evaluate(() => (window as unknown as { summaryQaAudio: { src: string; time: number; at: number }[] }).summaryQaAudio.filter(entry => entry.src.startsWith("blob:"))); }
test("narration waits for accepted past windows, then stops on disable without a stale backlog", async ({ page }) => {
  await monitorNativeAudio(page); await setup(page);
  const dialog = await recap(page), submitted = await start(page, dialog); await terminal(page, submitted.id);
  await expect(dialog).toContainText("Simulated synthetic-video recap");
  await dialog.getByLabel("Narrate during playback", { exact: true }).check();
  await dialog.getByRole("button", { name: "Close", exact: true }).click(); await expect(dialog).not.toBeVisible();
  const video = page.locator(".video-canvas video"); await page.getByRole("button", { name: "Play video", exact: true }).click();
  await expect.poll(() => video.evaluate((element: HTMLVideoElement) => element.currentTime)).toBeGreaterThan(0.4);
  expect((await qa(page, "audit")).speech).toHaveLength(0); expect(await audio(page)).toEqual([]);
  await video.evaluate((element: HTMLVideoElement) => { element.pause(); element.currentTime = 5.4; element.playbackRate = 2; });
  await page.getByRole("button", { name: "Play video", exact: true }).click();
  await expect.poll(async () => (await qa(page, "audit")).speech.length).toBe(1);
  expect((await qa(page, "audit")).speech[0].text).toContain("Simulated window 1");
  await expect.poll(async () => (await audio(page)).length).toBeGreaterThan(0);
  expect((await audio(page)).every(entry => entry.time >= 6)).toBe(true);
  await video.evaluate((element: HTMLVideoElement) => element.pause());
  await page.getByTestId("video-recap-open").click(); await dialog.getByLabel("Narrate during playback", { exact: true }).uncheck();
  await dialog.getByRole("button", { name: "Close", exact: true }).click(); await expect(dialog).not.toBeVisible();
  const before = (await qa(page, "audit")).speech.length;
  await video.evaluate((element: HTMLVideoElement) => { element.currentTime = 11.4; });
  await page.getByRole("button", { name: "Play video", exact: true }).click();
  await expect.poll(() => video.evaluate((element: HTMLVideoElement) => element.currentTime)).toBeGreaterThan(12.2);
  expect((await qa(page, "audit")).speech.length).toBe(before);
});
test("slow narration cannot play after seeking past it or replacing its source", async ({ page }) => {
  await monitorNativeAudio(page); await setup(page);
  const dialog = await recap(page), submitted = await start(page, dialog); await terminal(page, submitted.id);
  await expect(dialog).toContainText("Simulated synthetic-video recap");
  await qa(page, "control", { tts_delay_ms: 2500 });
  await dialog.getByLabel("Narrate during playback", { exact: true }).check();
  await dialog.getByRole("button", { name: "Close", exact: true }).click(); await expect(dialog).not.toBeVisible();
  const video = page.locator(".video-canvas video");
  await video.evaluate((element: HTMLVideoElement) => { element.currentTime = 5.4; element.playbackRate = 2; });
  await page.getByRole("button", { name: "Play video", exact: true }).click();
  await expect.poll(async () => (await qa(page, "audit")).speech.length).toBe(1);
  await video.evaluate((element: HTMLVideoElement) => { element.currentTime = 17.3; element.pause(); });
  await page.getByTestId("workspace-video-input").setInputFiles({ name: "New narration source.mp4", mimeType: "video/mp4", buffer: await fs.readFile(clip) });
  await expect.poll(async () => (await qa(page, "audit")).input.source_id).not.toBe(submitted.source.id);
  expect(await job(page)).toBeNull();
  await expect.poll(async () => (await qa(page, "audit")).speech[0]?.cancelled).toBe(true);
  expect(await audio(page)).toEqual([]);
  expect(await page.evaluate(() => (window as unknown as { summaryQaFallbackSpeech: unknown[] }).summaryQaFallbackSpeech)).toEqual([]);
});

const profiles = [
  { name: "desktop Chrome", browserName: "chromium" as const, channel: "chrome", viewport: { width: 1440, height: 1000 }, isMobile: false, hasTouch: false, colorScheme: "light" as const },
  { name: "320px Chrome phone", browserName: "chromium" as const, channel: "chrome", viewport: { width: 320, height: 740 }, isMobile: true, hasTouch: true, colorScheme: "light" as const },
  { name: "WebKit tablet", browserName: "webkit" as const, channel: "", viewport: { width: 820, height: 1180 }, isMobile: true, hasTouch: true, colorScheme: "light" as const },
  { name: "WebKit dark phone", browserName: "webkit" as const, channel: "", viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, colorScheme: "dark" as const },
];
for (const profile of profiles) {
  const { name: _name, ...options } = profile;
  const check = test.extend({ ...options, launchOptions: profile.browserName === "webkit" ? {} : { args: ["--use-fake-ui-for-media-stream"] } });
  check.describe(profile.name, () => {
    check("recap controls, evidence and JSON are readable, keyboard reachable and source-guarded", async ({ page }, info) => {
      await page.addInitScript(theme => localStorage.setItem("process-guide-theme", theme), profile.colorScheme);
      await setup(page); if (profile.name.includes("phone")) await page.evaluate(() => { document.documentElement.style.fontSize = "200%"; });
      const dialog = await recap(page); await fits(page, dialog); await capture(page, info, "recap-options.png");
      await expect(dialog.getByRole("combobox", { name: /^Analysis detail/ })).toBeEnabled();
      await expect(dialog.getByRole("combobox", { name: /^Process domain/ })).toBeEnabled();
      await accessibility(page, info, "options");
      if (profile.name.includes("phone")) {
        await fullVisible(dialog, dialog.getByRole("heading", { name: "Video recap", exact: true }));
        await capture(page, info, "recap-title.png");
        await fullVisible(dialog, dialog.getByLabel("Narrate during playback", { exact: true }));
        await fullVisible(dialog, dialog.getByRole("button", { name: "Open workflow report", exact: true }));
        await capture(page, info, "recap-footer.png");
        if (profile.name.includes("320px")) {
          await page.setViewportSize({ width: 320, height: 480 });
          await fullVisible(dialog, dialog.getByRole("heading", { name: "Video recap", exact: true }));
          await fullVisible(dialog, dialog.getByRole("button", { name: "Start video recap", exact: true }));
          await fullVisible(dialog, dialog.getByRole("button", { name: "Open workflow report", exact: true }));
          await fits(page, dialog); await capture(page, info, "recap-short-window.png");
          await page.setViewportSize(profile.viewport);
        }
      }
      const submitted = await start(page, dialog, "manufacturing"), result = await terminal(page, submitted.id);
      await expect(dialog).toContainText("Simulated synthetic-video recap"); await expect(dialog).toContainText(/simulated/i);
      await fullVisible(dialog, dialog.locator(".recap-overview h2"));
      await fits(page, dialog); await capture(page, info, "recap-result.png");
      await expect(dialog.getByRole("progressbar", { name: "Video recap processing", exact: true })).toHaveAttribute("value", "3");
      await accessibility(page, info, "result");
      await contrastPairs(dialog, info);
      const finding = result.windows[0]!.events[0]!;
      await dialog.getByText("Inspect 3 processed windows", { exact: true }).click();
      const evidence = dialog.getByRole("button", { name: `View evidence ${finding.id}`, exact: true });
      await evidence.scrollIntoViewIfNeeded(); await evidence.focus(); await expect(evidence).toBeFocused(); await page.keyboard.press("Enter");
      await expect(dialog.getByTestId("video-recap-evidence")).toContainText(finding.detail);
      await fits(page, dialog); await capture(page, info, "recap-evidence.png"); await accessibility(page, info, "evidence"); await download(page, dialog);
      const sourceFrame = result.windows[0]!.sampled_frames.find(frame => frame.id === finding.frame_refs[0])!;
      await dialog.getByTestId("video-recap-evidence").getByRole("button", { name: `View evidence ${sourceFrame.id}`, exact: true }).click();
      await expect(dialog.getByTestId("video-recap-evidence")).toContainText(sourceFrame.id);
      await dialog.getByTestId("video-recap-evidence").getByRole("button", { name: "Review this moment in video", exact: true }).click();
      await expect(dialog).not.toBeVisible();
      await expect.poll(() => page.locator(".video-canvas video").evaluate((video: HTMLVideoElement) => video.currentTime)).toBeCloseTo(sourceFrame.time_s, 1);
      await page.getByTestId("video-recap-open").click(); await expect(dialog).toBeVisible();
      await page.keyboard.press("Escape"); await expect(dialog).not.toBeVisible();
    });
  });
}
