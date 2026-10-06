import { expect, test, type Locator, type Page, type TestInfo } from "@playwright/test";
import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

// Run against scripts/report-qa-fixture.mts on an isolated loopback port.
const directory = await fs.mkdtemp(path.join(os.tmpdir(), "cueveris-report-browser-"));
const clip = path.join(directory, "synthetic-review.mp4");
const document = [
  "Step 1: Prepare", "Actions: Retain the component.", "Criteria: Component visibly present; Measurement still requires evidence.",
  "Step 2: Inspect", "Actions: Inspect assembly.", "Criteria: Alignment recorded; Label partly visible.",
  "Step 3: Finish", "Actions: Review component.", "Criteria: Final result documented.",
].join("\n");

test.beforeAll(() => execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "testsrc2=size=640x360:rate=12", "-t", "60", "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", "-y", clip]));
test.afterAll(async () => fs.rm(directory, { recursive: true, force: true }));

async function headers(page: Page) {
  return { "X-Guidance-Session": (await page.evaluate(() => sessionStorage.getItem("process-guide-session")))! };
}
async function snapshot(page: Page) {
  const response = await page.request.get("/__report_qa/snapshot", { headers: await headers(page) });
  expect(response.ok()).toBe(true);
  const result = await response.json();
  delete result.generated_at;
  return result;
}
async function pause(page: Page) {
  const video = page.locator(".video-canvas video");
  await expect(video).toBeVisible();
  await expect.poll(() => video.evaluate((element: HTMLVideoElement) => element.readyState)).toBeGreaterThanOrEqual(2);
  const button = page.getByRole("button", { name: "Pause guidance", exact: true });
  if (await button.isVisible()) await button.click();
  else if (await page.getByRole("button", { name: "Sources and setup", exact: true }).isVisible()) {
    await page.getByRole("button", { name: "Sources and setup", exact: true }).click();
    if (await button.isVisible()) await button.click();
    await page.getByRole("button", { name: "Close sources", exact: true }).click();
  }
  await video.evaluate((element: HTMLVideoElement) => element.pause());
}
async function enterWorkspace(page: Page) {
  const button = page.getByRole("button", { name: "Open workspace", exact: true });
  await button.click();
}
async function setup(page: Page, mode = "mixed") {
  await page.goto("/");
  await page.getByTestId("intro-document-input").setInputFiles({ name: "Report fixture.txt", mimeType: "text/plain", buffer: Buffer.from(document) });
  await expect(page.getByText("Report fixture.txt · 3 steps extracted")).toBeVisible();
  await page.getByTestId("intro-video-input").setInputFiles(clip);
  await enterWorkspace(page);
  await expect.poll(() => page.locator(".video-canvas video").evaluate((video: HTMLVideoElement) => video.readyState)).toBeGreaterThanOrEqual(2);
  await pause(page);
  const response = await page.request.post("/__report_qa/seed", { headers: await headers(page), data: { mode } });
  expect(response.ok()).toBe(true);
  // Rehydrate the actual API data, rather than presenting route-only mock views.
  await page.reload();
  if (mode === "long") {
    await expect(page.getByText(/FULL_IDENTITY_END_6789/).first()).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)).toBe(true);
  }
  await enterWorkspace(page);
  await expect.poll(() => page.locator(".video-canvas video").evaluate((video: HTMLVideoElement) => video.readyState)).toBeGreaterThanOrEqual(2);
  await pause(page);
  // Entering the workspace legitimately starts guidance. Establish the final
  // report records only after that real observer and playback have been paused,
  // then refresh the mounted UI through its ordinary reference/review reads.
  const finalSeed = await page.request.post("/__report_qa/seed", { headers: await headers(page), data: { mode } });
  expect(finalSeed.ok()).toBe(true);
  const seeded = await finalSeed.json();
  const referenceRead = page.waitForResponse(async response => {
    if (new URL(response.url()).pathname !== "/api/reference" || response.request().method() !== "GET" || !response.ok()) return false;
    return (await response.json()).revision === seeded.session_revision;
  });
  const reviewRead = page.waitForResponse(async response => {
    if (new URL(response.url()).pathname !== "/api/review" || response.request().method() !== "GET" || !response.ok()) return false;
    return (await response.json()).review_version === seeded.review_version;
  });
  await page.evaluate(() => window.dispatchEvent(new CustomEvent("guidance-reference-updated")));
  await Promise.all([referenceRead, reviewRead]);
  delete seeded.generated_at;
  expect(await snapshot(page)).toEqual(seeded);
}
async function report(page: Page) {
  const button = page.getByRole("button", { name: "Report", exact: true });
  if (!(await button.isVisible())) await page.getByRole("button", { name: "Sources and setup", exact: true }).click();
  await button.click();
  const dialog = page.getByRole("dialog").filter({ has: page.getByRole("heading", { name: "Session report", exact: true }) });
  await expect(dialog).toBeVisible();
  if (process.env.REPORT_QA_FAST_REPORT === "1") return dialog;
  const current = await snapshot(page);
  await expect(dialog.locator(".report-scope")).toContainText(`Review ${current.review_version}`);
  await page.evaluate(() => document.fonts.ready);
  await expect.poll(() => dialog.evaluate(element => {
    const matrix = new DOMMatrixReadOnly(getComputedStyle(element).transform);
    return Math.abs(matrix.a - 1) + Math.abs(matrix.d - 1);
  })).toBeLessThan(0.001);
  return dialog;
}
async function navigate(dialog: Locator, name: string) {
  const geometry = async (label: string) => {
    if (!process.env.REPORT_QA_GEOMETRY) return;
    const values = await dialog.evaluate((element, label) => {
      const body = element.querySelector<HTMLElement>(".report-body")!;
      const timeline = element.querySelector<HTMLElement>('[data-report-section="timeline"]')!;
      const queue = element.querySelector<HTMLElement>(".report-review-queue")!;
      return { label, time: performance.now(), scrollTop: body.scrollTop, clientHeight: body.clientHeight,
        scrollHeight: body.scrollHeight, timeline_relative_top: timeline.getBoundingClientRect().top - body.getBoundingClientRect().top,
        transform: getComputedStyle(element).transform, queue_steps: queue.querySelectorAll("button").length,
        reduced_motion: matchMedia("(prefers-reduced-motion: reduce)").matches,
        review_scope: element.querySelector(".report-scope .report-small-count")?.textContent };
    }, label);
    await fs.appendFile(process.env.REPORT_QA_GEOMETRY, JSON.stringify(values) + "\n");
  };
  await geometry(`before ${name} click`);
  await dialog.getByRole("navigation", { name: "Report sections", exact: true }).getByRole("button", { name, exact: true }).click();
  await geometry(`after ${name} click`);
  if (process.env.REPORT_QA_GEOMETRY) {
    await new Promise(resolve => setTimeout(resolve, 100)); await geometry(`100ms after ${name} click`);
    await new Promise(resolve => setTimeout(resolve, 300)); await geometry(`400ms after ${name} click`);
  }
  const section = dialog.locator(`[data-report-section="${name.toLowerCase()}"]`);
  await expect(section).toBeFocused();
  await expect.poll(async () => {
    const heading = await section.locator("h3").first().boundingBox();
    const body = await dialog.locator(".report-body").boundingBox();
    if (!heading || !body) return -1;
    return Math.min(heading.y - body.y, body.y + body.height - heading.y - heading.height);
  }, { message: `The ${name} heading is within the report reading viewport after native navigation` }).toBeGreaterThanOrEqual(-1);
}
async function fits(page: Page, dialog: Locator) {
  await expect(dialog.getByRole("button", { name: "Close", exact: true })).toBeInViewport();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  expect(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
  const reading = await dialog.locator(".report-body").evaluate(element => {
    const bounds = element.getBoundingClientRect();
    return { clientWidth: element.clientWidth, scrollWidth: element.scrollWidth,
      overflowing: [...element.querySelectorAll<HTMLElement>("*")].filter(child => child.getBoundingClientRect().right > bounds.right + 1).slice(0, 8)
        .map(child => ({ tag: child.tagName, className: child.className, width: child.getBoundingClientRect().width, text: child.textContent?.slice(0, 100) })) };
  });
  expect(reading.scrollWidth, JSON.stringify(reading)).toBeLessThanOrEqual(reading.clientWidth + 1);
}
async function capture(page: Page, info: TestInfo, name: string) {
  const file = info.outputPath(name);
  await page.screenshot({ path: file, fullPage: true, animations: "disabled" });
  await info.attach(name, { path: file, contentType: "image/png" });
  if (process.env.REPORT_QA_SCREENSHOTS) {
    await fs.mkdir(process.env.REPORT_QA_SCREENSHOTS, { recursive: true });
    const profile = info.titlePath.find(part => /^(?:desktop Chrome|320px Chrome phone|WebKit tablet|WebKit dark phone)$/.test(part)) || info.project.name || "browser";
    await fs.copyFile(file, path.join(process.env.REPORT_QA_SCREENSHOTS, `${profile.replace(/[^a-zA-Z0-9_-]/g, "-")}-${name}`));
  }
}
function monitor(page: Page) {
  const provider: string[] = [], mutations: string[] = [];
  const listener = (request: { url(): string; method(): string }) => {
    const route = new URL(request.url()).pathname;
    if (/^\/api\/(?:reference\/parse-ai|guidance\/analyze|monitor\/check|workflow\/infer|llm\/(?:ask|summarize)|history\/digest|tts|compare)(?:\/|$)/.test(route)) provider.push(route);
    if (request.method() !== "GET" && /^\/api\/(?:source|reference|video\/(?:upload|load-sample)|preferences|review|readiness|confirm|workflow)(?:\/|$)/.test(route)) mutations.push(`${request.method()} ${route}`);
  };
  page.on("request", listener);
  return { provider, mutations };
}

const errors = new WeakMap<Page, string[]>();
test.beforeEach(async ({ page, colorScheme }) => {
  const messages: string[] = [];
  errors.set(page, messages);
  page.on("pageerror", error => messages.push(error.message));
  await page.addInitScript(theme => localStorage.setItem("process-guide-theme", theme), colorScheme === "dark" ? "dark" : "light");
});
test.afterEach(async ({ page }) => expect(errors.get(page)).toEqual([]));

const profiles = [
  { name: "desktop Chrome", browserName: "chromium" as const, channel: "chrome", viewport: { width: 1440, height: 1000 }, isMobile: false, hasTouch: false, colorScheme: "light" as const },
  { name: "320px Chrome phone", browserName: "chromium" as const, channel: "chrome", viewport: { width: 320, height: 740 }, isMobile: true, hasTouch: true, colorScheme: "light" as const },
  { name: "WebKit tablet", browserName: "webkit" as const, channel: "", viewport: { width: 820, height: 1180 }, isMobile: true, hasTouch: true, colorScheme: "light" as const },
  { name: "WebKit dark phone", browserName: "webkit" as const, channel: "", viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, colorScheme: "dark" as const },
];
for (const profile of profiles) {
  const { name: _name, ...options } = profile;
  const check = test.extend({ ...options, launchOptions: profile.browserName === "webkit" ? {} : { args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"] } });
  check.describe(profile.name, () => {
    check("report links preserve reference identity and show unresolved steps without mutating records", async ({ page }, info) => {
      await setup(page);
      const before = await snapshot(page);
      const activity = monitor(page);
      const dialog = await report(page);
      const scope = dialog.getByRole("complementary", { name: "Evidence scope and report identity" });
      await expect(scope).toContainText("3 records, 2 photos and 1 issue");
      await capture(page, info, "initial-overview.png");
      const queue = dialog.getByRole("region", { name: "Criterion review queue" });
      await expect(queue.getByRole("button", { name: /^Review step / })).toHaveCount(3);
      await expect(queue).toContainText("Manual confirmation");
      await expect(queue).toContainText("1 not met");
      await expect(queue.getByRole("button", { name: /^Review step / }).first()).toHaveAccessibleName("Review step Inspect");
      await queue.getByRole("button", { name: "Review step Inspect", exact: true }).click();
      const inspect = dialog.locator('[data-report-step="S2"]');
      await expect(inspect).toHaveAttribute("open", "");
      await expect(inspect).toBeFocused();
      await navigate(dialog, "Issues");
      const issues = dialog.getByRole("region", { name: "Open review issues", exact: true });
      await issues.locator('[data-report-issue="current-issue"]').getByRole("button", { name: "View evidence E02", exact: true }).click();
      const alignment = dialog.locator('[data-report-event="current-alignment"]');
      await expect(alignment).toBeFocused();
      await expect(alignment).toHaveAccessibleName("E02 · current-alignment");
      await alignment.getByRole("button", { name: "View workflow step Inspect", exact: true }).click();
      await expect(inspect).toBeFocused();
      await navigate(dialog, "Issues");
      await issues.locator('[data-report-issue="earlier-issue"]').getByRole("button", { name: "View evidence E01", exact: true }).click();
      const earlier = dialog.locator('[data-report-event="earlier-reused-S1"]');
      await expect(earlier).toBeFocused();
      await expect(earlier).toContainText("Step links belong to earlier instructions.");
      await expect(earlier.getByRole("button", { name: /^View workflow step / })).toHaveCount(0);
      const orphan = dialog.locator('[data-report-event="orphan-step-record"]');
      await orphan.scrollIntoViewIfNeeded();
      await expect(orphan).toContainText("Linked step is not available in this workflow.");
      await navigate(dialog, "Issues");
      await expect(issues.locator('[data-report-issue="orphan-issue"]')).toContainText("Linked evidence is not retained in this snapshot.");
      await navigate(dialog, "Evidence");
      const evidence = dialog.getByRole("region", { name: "Recorded evidence", exact: true });
      await evidence.getByLabel("Evidence type", { exact: true }).selectOption("bookmark");
      await expect(evidence.getByRole("article")).toHaveCount(1);
      await expect(evidence.getByRole("article")).toHaveAccessibleName("E03 · operator-bookmark");
      await navigate(dialog, "Issues");
      await issues.locator('[data-report-issue="current-issue"]').getByRole("button", { name: "View evidence E02", exact: true }).click();
      await expect(alignment).toBeFocused();
      await expect(evidence.getByLabel("Evidence type", { exact: true })).toHaveValue("all");
      await fits(page, dialog);
      await capture(page, info, "linked-evidence.png");
      expect(await snapshot(page)).toEqual(before);
      expect(activity.provider).toEqual([]); expect(activity.mutations).toEqual([]);
    });

    check("known duration preserves gaps while excluding demo, overview and out-of-range timestamps", async ({ page }, info) => {
      await setup(page);
      const before = await snapshot(page), activity = monitor(page);
      const dialog = await report(page);
      await navigate(dialog, "Timeline");
      const timeline = dialog.getByRole("region", { name: "Recorded timeline", exact: true });
      await expect(timeline).toContainText("01:00 · source duration");
      await expect(timeline).toContainText("Last retained moment: 00:30");
      await expect(timeline).toContainText("1 record falls outside the known source duration");
      await expect(timeline.getByLabel("Choose recorded moment").locator("option")).toHaveCount(4);
      const optionText = await timeline.getByLabel("Choose recorded moment").locator("option").allTextContents();
      expect(optionText.join(" ")).not.toMatch(/demo-observation|whole-video-overview|outside-source-duration/);
      await expect(timeline.getByRole("img", { name: /^4 retained moments/ })).toHaveAccessibleName(/4 retained moments across known source duration 00:00 to 01:00/);
      await timeline.getByLabel("Choose recorded moment").selectOption("operator-bookmark");
      await expect(timeline.locator(".report-selected-moment")).toContainText("E03");
      await expect(timeline.locator(".report-selected-moment")).toContainText("Operator record");
      await navigate(dialog, "Timeline");
      await fits(page, dialog); await capture(page, info, "duration-timeline.png");
      await navigate(dialog, "Evidence");
      await expect(dialog.locator('[data-report-event="outside-source-duration"]')).toContainText("Excluded from timeline: timestamp is outside the known source duration.");
      expect(await snapshot(page)).toEqual(before);
      expect(activity.provider).toEqual([]); expect(activity.mutations).toEqual([]);
    });

    check("full identity and large text remain readable and keyboard reachable", async ({ page }, info) => {
      await setup(page, "long");
      const before = await snapshot(page), activity = monitor(page);
      await page.evaluate(() => { document.documentElement.style.fontSize = "200%"; });
      const dialog = await report(page);
      const brandingCoversClose = await dialog.evaluate(element => {
        const branding = element.querySelector(".report-dialog-header > p:first-child")!;
        const close = element.querySelector(".dialog-close")!.getBoundingClientRect();
        const text = document.createRange();
        text.selectNodeContents(branding);
        return [...text.getClientRects()].some(rect =>
          rect.left < close.right && rect.right > close.left && rect.top < close.bottom && rect.bottom > close.top,
        );
      });
      expect(brandingCoversClose, "The full masthead text does not paint under the Close button").toBe(false);
      const identity = dialog.locator(".report-identity");
      await identity.locator("summary").click();
      await expect(identity).toContainText("FULL_IDENTITY_END_6789");
      await identity.scrollIntoViewIfNeeded();
      await fits(page, dialog);
      for (const name of ["Previous recorded moment", "Next recorded moment"]) {
        const icon = (await dialog.getByRole("button", { name, exact: true }).boundingBox())!;
        expect(icon.width).toBeCloseTo(44, 0);
        expect(icon.height).toBeCloseTo(44, 0);
      }
      await navigate(dialog, "Workflow");
      const target = dialog.locator('[data-report-step="S2"]');
      await target.scrollIntoViewIfNeeded();
      await expect(target).toContainText("STEP_NAME_END_6789");
      await expect(target).toContainText("CRITERION_END_6789");
      if (profile.name === "320px Chrome phone") {
        const title = (await target.locator("summary h4").boundingBox())!;
        expect(title.width, "The long step title has a full reading row rather than a narrow slot beside the number and arrow").toBeGreaterThanOrEqual(180);
      }
      const criterion = await target.locator("ul.divide-y > li").first().evaluate(element => {
        const label = element.querySelector("div > p")!;
        const status = element.querySelector("div > span")!;
        const textStyle = getComputedStyle(label);
        const context = document.createElement("canvas").getContext("2d")!;
        context.font = `${textStyle.fontStyle} ${textStyle.fontWeight} ${textStyle.fontSize} ${textStyle.fontFamily}`;
        const firstWord = label.textContent!.trim().split(/\s+/)[0];
        return { labelWidth: label.getBoundingClientRect().width, firstWordWidth: context.measureText(firstWord).width,
          labelBottom: label.getBoundingClientRect().bottom, statusTop: status.getBoundingClientRect().top };
      });
      expect(criterion.labelWidth, "A normal criterion word fits intact instead of being squeezed beside its status").toBeGreaterThanOrEqual(criterion.firstWordWidth);
      if (profile.name === "320px Chrome phone") expect(criterion.statusTop).toBeGreaterThanOrEqual(criterion.labelBottom - 1);
      await fits(page, dialog); await capture(page, info, "large-text-workflow.png");
      if (profile.name === "320px Chrome phone") {
        const label = target.locator("ul.divide-y > li").first().locator("div > p");
        await label.evaluate(element => element.scrollIntoView({ block: "start", inline: "nearest", behavior: "instant" }));
        const body = (await dialog.locator(".report-body").boundingBox())!;
        const visibleLabel = (await label.boundingBox())!;
        expect(visibleLabel.y).toBeGreaterThanOrEqual(body.y - 1);
        expect(visibleLabel.y).toBeLessThan(body.y + body.height);
        await capture(page, info, "large-text-criterion.png");
      }
      const close = dialog.getByRole("button", { name: "Close", exact: true });
      await close.focus();
      await expect(close).toBeFocused();
      if (profile.name === "320px Chrome phone") await close.click();
      else await page.keyboard.press("Enter");
      await expect(dialog).toBeHidden();
      expect(await snapshot(page)).toEqual(before);
      expect(activity.provider).toEqual([]); expect(activity.mutations).toEqual([]);
    });

    check("empty workflow and older unknown-duration payloads remain truthful", async ({ page }) => {
      await setup(page, "empty");
      const emptyBefore = await snapshot(page), emptyActivity = monitor(page);
      const dialog = await report(page);
      await expect(dialog.getByRole("region", { name: "Review priorities" })).toContainText("No workflow recorded.");
      await expect(dialog.getByRole("region", { name: "Criterion review queue" })).toContainText("No unresolved criteria are recorded.");
      await expect(dialog.locator(".report-ring")).toHaveAttribute("aria-label", "No workflow steps yet");
      await navigate(dialog, "Timeline");
      await expect(dialog.getByRole("region", { name: "Recorded timeline" })).toContainText("No real moments retained yet");
      await fits(page, dialog);
      await dialog.getByRole("button", { name: "Close", exact: true }).click();
      await expect(dialog).toBeHidden();
      expect(await snapshot(page)).toEqual(emptyBefore);
      expect(emptyActivity.provider).toEqual([]); expect(emptyActivity.mutations).toEqual([]);
      await setup(page, "unknown");
      const olderBefore = await snapshot(page), olderActivity = monitor(page);
      // An older server omits the additive duration field; no guessed video extent.
      await page.route("**/api/review?**", async route => {
        const response = await route.fetch();
        const json = await response.json(); delete json.source_duration_s;
        await route.fulfill({ response, json });
      });
      const older = await report(page);
      await navigate(older, "Timeline");
      const timeline = older.getByRole("region", { name: "Recorded timeline" });
      await expect(timeline).toContainText("01:30 · last retained moment");
      await expect(timeline).toContainText("Source duration is unavailable.");
      await expect(timeline.getByLabel("Choose recorded moment").locator("option")).toHaveCount(5);
      await fits(page, older);
      expect(await snapshot(page)).toEqual(olderBefore);
      expect(olderActivity.provider).toEqual([]); expect(olderActivity.mutations).toEqual([]);
    });

    if (profile.name === "desktop Chrome" || profile.name === "WebKit tablet") check("linked evidence outside the first page is revealed without fetching or changing records", async ({ page }) => {
      await setup(page, "paged");
      const before = await snapshot(page), activity = monitor(page);
      const reads: string[] = [];
      page.on("request", request => { if (new URL(request.url()).pathname === "/api/review") reads.push(request.url()); });
      const dialog = await report(page);
      await navigate(dialog, "Evidence");
      await expect(dialog.getByRole("region", { name: "Recorded evidence" }).getByRole("article")).toHaveCount(12);
      await expect(dialog.locator('[data-report-event="current-alignment"]')).toHaveCount(0);
      await navigate(dialog, "Issues");
      const beforeLink = reads.length;
      await dialog.getByRole("region", { name: "Open review issues" }).locator('[data-report-issue="current-issue"]').getByRole("button", { name: "View evidence E02", exact: true }).click();
      await expect(dialog.locator('[data-report-event="current-alignment"]')).toBeFocused();
      expect(reads.length).toBe(beforeLink);
      expect(await snapshot(page)).toEqual(before);
      expect(activity.provider).toEqual([]); expect(activity.mutations).toEqual([]);
    });

    if (profile.name === "desktop Chrome" || profile.name === "WebKit tablet") check("saved PDF and offline HTML preserve the snapshot after live guidance changes", async ({ page }) => {
      await setup(page);
      await page.getByRole("button", { name: "Account and training", exact: true }).click();
      let account = page.getByRole("dialog");
      await account.getByRole("button", { name: "Create account", exact: true }).click();
      await account.getByLabel("Name", { exact: true }).fill("Synthetic report reviewer");
      await account.getByLabel("Email", { exact: true }).fill(`report-${Date.now()}@example.com`);
      await account.getByLabel("Password", { exact: true }).fill("synthetic-report-passphrase-2026");
      await account.getByRole("button", { name: "Create my account", exact: true }).click();
      await account.getByRole("button", { name: "Save current result", exact: true }).click();
      await expect(account.getByRole("article")).toHaveCount(1);
      await page.keyboard.press("Escape"); await expect(account).toBeHidden();
      const response = await page.request.post("/__report_qa/seed", { headers: await headers(page), data: { mode: "long" } });
      expect(response.ok()).toBe(true);
      await page.reload();
      await enterWorkspace(page); await pause(page);
      await page.getByRole("button", { name: "Account and training", exact: true }).click();
      account = page.getByRole("dialog");
      await expect(account.getByRole("article")).toHaveCount(1);
      const liveBefore = await snapshot(page);
      const activity = monitor(page);
      const htmlDownload = page.waitForEvent("download");
      await account.getByRole("button", { name: "Offline HTML", exact: true }).click();
      const html = await fs.readFile((await (await htmlDownload).path())!, "utf8");
      expect(html).toContain("Synthetic report review clip");
      expect(html).toContain("Current alignment issue");
      expect(html).toContain("E02");
      expect(html).not.toContain("FULL_IDENTITY_END_6789");
      expect(html).not.toMatch(/<(?:script|iframe)\b|(?:src|href)=["']https?:/);
      const pdfDownload = page.waitForEvent("download");
      await account.getByRole("button", { name: "PDF", exact: true }).click();
      const pdfPath = (await (await pdfDownload).path())!;
      const text = execFileSync("pdftotext", ["-layout", pdfPath, "-"], { encoding: "utf8" });
      expect(text).toContain("Synthetic report review clip");
      expect(text).toContain("Current alignment issue");
      expect(text).toContain("E02");
      expect(text).not.toContain("FULL_IDENTITY_END_6789");
      expect(await snapshot(page)).toEqual(liveBefore);
      expect(activity.provider).toEqual([]); expect(activity.mutations).toEqual([]);
    });
  });
}
