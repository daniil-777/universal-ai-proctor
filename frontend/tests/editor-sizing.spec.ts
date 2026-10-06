import { test, expect, type Locator, type Page, type TestInfo } from "@playwright/test";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const directory = fs.mkdtempSync(path.join(os.tmpdir(), "cueveris-editor-sizing-"));
const clips = [
  { name: "landscape", width: 640, height: 360 },
  { name: "portrait", width: 360, height: 640 },
  { name: "small native", width: 96, height: 64 },
].map(clip => ({ ...clip, file: path.join(directory, `${clip.width}x${clip.height}.mp4`) }));
const audioClip = path.join(directory, "audio.mp4");
const reference = Buffer.from(
  "Principles:\n- Preserve the original source evidence.\n" +
  "Step 1: Inspect the colored bands\nObjective: Locate all three colored bands.\n" +
  "Actions:\n- Inspect the colored bands.\nCriteria:\n- Red band visible.\n- Green band visible.\n- Blue band visible.\n" +
  "Step 2: Review the source\nActions:\n- Review the original full source.\nCriteria:\n- Original source remains available.\n",
);

test.beforeAll(() => {
  for (const clip of clips) {
    execFileSync("ffmpeg", [
      "-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i",
      `color=c=0x20bc66:s=${clip.width}x${clip.height}:r=12,drawbox=x=0:y=0:w=iw/3:h=ih:color=0xf05252:t=fill,drawbox=x=2*iw/3:y=0:w=iw/3:h=ih:color=0x4287eb:t=fill`,
      "-t", "12", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-y", clip.file,
    ]);
  }
  execFileSync("ffmpeg", [
    "-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i",
    "color=c=0x20bc66:s=640x360:r=12", "-f", "lavfi", "-i",
    "sine=frequency=440:sample_rate=48000", "-t", "12", "-c:v", "libx264",
    "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", "-y", audioClip,
  ]);
});
test.afterAll(() => fs.rmSync(directory, { recursive: true, force: true }));

const pageErrors = new WeakMap<Page, string[]>();
test.beforeEach(async ({ page }) => {
  const errors: string[] = [];
  pageErrors.set(page, errors);
  page.on("pageerror", error => errors.push(error.message));
  // The deterministic fixture handles visual requests. Speech is unnecessary
  // for sizing checks and must never reach a provider, even in another setup.
  await page.route("**/api/tts", route => route.fulfill({ status: 503, json: { error: "Sizing fixture: speech disabled" } }));
});
test.afterEach(async ({ page }) => expect(pageErrors.get(page) || []).toEqual([]));

async function workspace(page: Page, file = clips[0].file) {
  await page.goto("/");
  await page.getByTestId("intro-document-input").setInputFiles({ name: "Sizing.txt", mimeType: "text/plain", buffer: reference });
  await expect(page.getByText("Sizing.txt · 2 steps extracted")).toBeVisible();
  await page.getByTestId("intro-video-input").setInputFiles(file);
  await page.getByRole("button", { name: "Open workspace", exact: true }).click();
  const video = page.locator(".video-canvas video");
  await expect.poll(() => video.evaluate((element: HTMLVideoElement) => element.readyState)).toBeGreaterThanOrEqual(2);
  const guidancePause = page.getByRole("button", { name: "Pause guidance", exact: true });
  if (await guidancePause.isVisible()) await guidancePause.click();
  const pause = page.getByRole("button", { name: "Pause video", exact: true });
  if (await pause.isVisible()) await pause.click();
  await expect(video).toHaveJSProperty("paused", true);
  return video;
}

async function videoSize(page: Page) {
  await page.getByRole("button", { name: "Video size", exact: true }).click();
  return page.getByRole("dialog", { name: "Video size controls", exact: true });
}

async function checkPopupBounds(page: Page, controls: Locator) {
  const viewport = page.viewportSize()!;
  await expect.poll(async () => {
    const current = (await controls.boundingBox())!;
    return Math.min(current.x, current.y, viewport.width + 1 - current.x - current.width, viewport.height + 1 - current.y - current.height);
  }, { timeout: 2000, message: "The settled video-size popup fits entirely inside the viewport" }).toBeGreaterThanOrEqual(0);
  const box = (await controls.boundingBox())!;
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(viewport.width + 1);
  expect(box.y + box.height).toBeLessThanOrEqual(viewport.height + 1);
}

async function checkVideoPopup(page: Page, controls: Locator) {
  const viewport = page.viewportSize()!;
  await checkPopupBounds(page, controls);
  const buttons = ["Fill", "Full frame", "Use available height", "Reset video view"];
  const fields = ["Zoom percent", "Video editor height (px)"];
  for (const control of [
    ...buttons.map(name => controls.getByRole("button", { name, exact: true })),
    ...fields.map(name => controls.getByRole("spinbutton", { name, exact: true })),
  ]) {
    await control.scrollIntoViewIfNeeded();
    await expect(control).toBeVisible();
    const target = (await control.boundingBox())!;
    expect(target.y).toBeGreaterThanOrEqual(0);
    expect(target.y + target.height).toBeLessThanOrEqual(viewport.height + 1);
  }
}

async function setView(page: Page, name: "Fill" | "Full frame") {
  const controls = await videoSize(page);
  await controls.getByRole("button", { name, exact: true }).click();
  await page.keyboard.press("Escape");
}

async function imagePixels(page: Page, source: string, points: Array<[number, number]>) {
  return page.evaluate(async ({ source, points }) => {
    const image = new Image();
    image.src = source;
    await image.decode();
    const canvas = document.createElement("canvas");
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const context = canvas.getContext("2d")!;
    context.drawImage(image, 0, 0);
    return {
      width: canvas.width,
      height: canvas.height,
      pixels: points.map(([x, y]) => Array.from(context.getImageData(
        Math.min(canvas.width - 1, Math.floor(x * canvas.width)),
        Math.min(canvas.height - 1, Math.floor(y * canvas.height)), 1, 1,
      ).data).slice(0, 3)),
    };
  }, { source, points });
}

async function stagePixels(page: Page, points: Array<[number, number]>) {
  const screenshot = await page.locator(".video-canvas").screenshot({ animations: "disabled" });
  return imagePixels(page, `data:image/png;base64,${screenshot.toString("base64")}`, points);
}

async function saveScreenshot(page: Page, testInfo: TestInfo, name: string) {
  const file = testInfo.outputPath(name);
  await page.screenshot({ path: file, fullPage: true, animations: "disabled" });
  if (process.env.EDITOR_QA_SCREENSHOTS) {
    fs.mkdirSync(process.env.EDITOR_QA_SCREENSHOTS, { recursive: true });
    fs.copyFileSync(file, path.join(process.env.EDITOR_QA_SCREENSHOTS, `${testInfo.project.name}-${name}`));
  }
}

async function numeric(input: Locator, value: number) {
  await input.fill(String(value));
  await input.press("Tab");
}

async function guidanceSize(page: Page) {
  await page.getByRole("button", { name: "Adjust guidance size", exact: true }).click();
  await expect(page.getByRole("spinbutton", { name: "Guidance text size (px)", exact: true })).toBeVisible();
}

async function documentSnapshot(page: Page) {
  const session = await page.evaluate(() => sessionStorage.getItem("process-guide-session"));
  const origin = process.env.EDITOR_QA_API_BASE || new URL(page.url()).origin;
  const response = await page.request.get(`${origin}/api/reference/document`, { headers: { "X-Guidance-Session": session || "" } });
  expect(response.ok()).toBe(true);
  const document = await response.json();
  return { filename: document.filename, text: document.text };
}

test("the original default video fills the editor and keeps its source when fitted", async ({ page }, testInfo) => {
  await page.goto("/");
  await page.getByRole("combobox", { name: "Choose a sample video", exact: true }).click();
  await page.getByRole("option", { name: /Uncomplicated cholecystectomy/ }).click();
  await expect(page.getByText(/Cholecystectomy\.txt · \d+ steps extracted/)).toBeVisible();
  await page.getByRole("button", { name: "Open workspace", exact: true }).click();
  const video = page.locator(".video-canvas video");
  await expect.poll(() => video.evaluate((element: HTMLVideoElement) => element.readyState)).toBeGreaterThanOrEqual(2);
  const pause = page.getByRole("button", { name: "Pause guidance", exact: true });
  if (await pause.isVisible()) await pause.click();
  const playbackPause = page.getByRole("button", { name: "Pause video", exact: true });
  if (await playbackPause.isVisible()) await playbackPause.click();
  const source = await video.evaluate((element: HTMLVideoElement) => ({ src: element.currentSrc, width: element.videoWidth, height: element.videoHeight }));
  expect(source.width).toBeGreaterThan(0);
  expect(source.height).toBeGreaterThan(0);
  await expect(video).toHaveCSS("object-fit", "cover");
  const canvas = (await page.locator(".video-canvas").boundingBox())!;
  const box = (await video.boundingBox())!;
  expect(box.width).toBeCloseTo(canvas.width, 0);
  expect(box.height).toBeCloseTo(canvas.height, 0);
  await saveScreenshot(page, testInfo, "editor-default-desktop.png");
  await setView(page, "Full frame");
  await expect(video).toHaveCSS("object-fit", "contain");
  expect(await video.evaluate((element: HTMLVideoElement) => ({ src: element.currentSrc, width: element.videoWidth, height: element.videoHeight }))).toEqual(source);
  await expect(video).toHaveJSProperty("paused", true);
});

for (const clip of clips) {
  test(`video fills the canvas by default and full frame reveals every ${clip.name} pixel`, async ({ page }) => {
    const video = await workspace(page, clip.file);
    await expect(video).toHaveJSProperty("videoWidth", clip.width);
    await expect(video).toHaveJSProperty("videoHeight", clip.height);
    const hide = page.getByTitle("Hide guidance", { exact: true });
    if (await hide.isVisible()) await hide.click();
    await expect(page.locator(".video-canvas")).toHaveAttribute("data-video-fit", "fill");
    await expect(video).toHaveCSS("object-fit", "cover");
    const canvas = (await page.locator(".video-canvas").boundingBox())!;
    const box = (await video.boundingBox())!;
    expect(box.width).toBeCloseTo(canvas.width, 0);
    expect(box.height).toBeCloseTo(canvas.height, 0);
    if (clip.width === 96) expect(box.width).toBeGreaterThan(clip.width * 2);
    const filled = await stagePixels(page, [[.01, .25], [.5, .25], [.99, .25]]);
    for (const pixel of filled.pixels) expect(Math.max(...pixel), `Source color reaches the canvas edge: ${pixel}`).toBeGreaterThan(100);
    await setView(page, "Full frame");
    await expect(video).toHaveCSS("object-fit", "contain");
    const wider = clip.width / clip.height > canvas.width / canvas.height;
    const fitted = await stagePixels(page, wider ? [[.5, .01], [.5, .5]] : [[.01, .25], [.5, .25]]);
    expect(Math.max(...fitted.pixels[0]), "Full-frame letterbox is visible").toBeLessThan(35);
    expect(Math.max(...fitted.pixels[1]), "Source remains visible inside the letterbox").toBeGreaterThan(100);
    await setView(page, "Fill");
    await expect(video).toHaveJSProperty("paused", true);
  });
}

test("video crop preview preserves source dimensions and pixels through fill and zoom", async ({ page }) => {
  await workspace(page);
  await page.getByRole("button", { name: "Engineer", exact: true }).click();
  const preview = async (label: "Set analysis region" | "Edit analysis region") => {
    const trigger = page.getByRole("button", { name: label, exact: true });
    if (!(await trigger.isVisible())) await page.getByRole("button", { name: "Processing controls", exact: true }).click();
    await trigger.click();
    const image = page.getByRole("img", { name: "Current frame for crop preview", exact: true });
    await expect(image).toBeVisible();
    return image.getAttribute("src");
  };
  const original = (await preview("Set analysis region"))!;
  const pixels = await imagePixels(page, original, [[.08, .5], [.5, .5], [.92, .5]]);
  expect([pixels.width, pixels.height]).toEqual([640, 360]);
  expect(pixels.pixels[0][0]).toBeGreaterThan(pixels.pixels[0][1] * 1.5);
  expect(pixels.pixels[1][1]).toBeGreaterThan(pixels.pixels[1][0] * 1.5);
  expect(pixels.pixels[2][2]).toBeGreaterThan(pixels.pixels[2][0] * 1.5);
  const right = page.getByRole("slider", { name: "Right crop boundary", exact: true });
  await right.focus();
  await right.press("End");
  for (let index = 0; index < 25; index++) await right.press("ArrowLeft");
  await expect(right).toHaveAttribute("aria-valuenow", "75");
  await page.getByRole("button", { name: "Apply region", exact: true }).click();
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  const controls = await videoSize(page);
  await numeric(controls.getByRole("spinbutton", { name: "Zoom percent", exact: true }), 230);
  await page.keyboard.press("Escape");
  await setView(page, "Full frame");
  const changed = await preview("Edit analysis region");
  expect(changed, "Display sizing must not crop or scale the source frame").toBe(original);
  await expect(page.getByRole("slider", { name: "Right crop boundary", exact: true })).toHaveAttribute("aria-valuenow", "75");
  await page.keyboard.press("Escape");
});

test("guidance dimensions and text persist, reset and leave the document unchanged", async ({ page }) => {
  await workspace(page);
  const before = await documentSnapshot(page);
  const reading = page.locator(".guidance-reading[data-state=active]");
  const criterion = reading.getByText("Red band visible.", { exact: true });
  const initialFont = await criterion.evaluate(element => parseFloat(getComputedStyle(element).fontSize));
  const initialHeight = (await reading.boundingBox())!.height;
  await guidanceSize(page);
  await numeric(page.getByRole("spinbutton", { name: "Guidance width (px)", exact: true }), 420);
  await numeric(page.getByRole("spinbutton", { name: "Guidance height (px)", exact: true }), 460);
  await numeric(page.getByRole("spinbutton", { name: "Guidance text size (px)", exact: true }), 30);
  await page.keyboard.press("Escape");
  await expect.poll(async () => (await page.locator(".workspace-guidance").boundingBox())!.width).toBeCloseTo(420, 0);
  expect((await reading.boundingBox())!.height).toBeLessThan(initialHeight - 100);
  expect(await criterion.evaluate(element => parseFloat(getComputedStyle(element).fontSize))).toBeGreaterThan(initialFont * 1.5);
  expect(await documentSnapshot(page)).toEqual(before);
  await page.reload();
  await page.getByRole("button", { name: "Open workspace", exact: true }).click();
  await guidanceSize(page);
  await expect(page.getByRole("spinbutton", { name: "Guidance text size (px)", exact: true })).toHaveValue("30");
  await expect(page.getByRole("spinbutton", { name: "Guidance width (px)", exact: true })).toHaveValue("420");
  await expect(page.getByRole("spinbutton", { name: "Guidance height (px)", exact: true })).toHaveValue("460");
  await page.getByRole("button", { name: "Reset layout and text", exact: true }).click();
  await page.keyboard.press("Escape");
  expect(await criterion.evaluate(element => parseFloat(getComputedStyle(element).fontSize))).toBeCloseTo(initialFont, 0);
  expect(await documentSnapshot(page)).toEqual(before);
});

test("editor divider drag and arrows resize width and height without seeking or playing", async ({ page }) => {
  const video = await workspace(page);
  await video.evaluate((element: HTMLVideoElement) => { element.currentTime = 3; });
  await expect.poll(() => video.evaluate((element: HTMLVideoElement) => element.seeking)).toBe(false);
  const divider = page.getByTestId("workspace-editor-divider");
  const pane = page.locator(".workspace-guidance");
  const initial = (await pane.boundingBox())!;
  const grip = (await divider.boundingBox())!;
  await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2);
  await page.mouse.down();
  await page.mouse.move(grip.x - 90, grip.y + grip.height / 2, { steps: 8 });
  await page.mouse.up();
  expect((await pane.boundingBox())!.width).toBeGreaterThan(initial.width + 50);
  await divider.focus();
  await page.keyboard.press("ArrowRight");
  await expect(video).toHaveJSProperty("paused", true);
  expect(await video.evaluate((element: HTMLVideoElement) => element.currentTime)).toBeCloseTo(3, 1);
  const heightDivider = page.getByTestId("guidance-height-divider");
  const heightGrip = (await heightDivider.boundingBox())!;
  const readingBefore = (await page.locator(".guidance-reading[data-state=active]").boundingBox())!.height;
  await page.mouse.move(heightGrip.x + heightGrip.width / 2, heightGrip.y + heightGrip.height / 2);
  await page.mouse.down();
  await page.mouse.move(heightGrip.x + heightGrip.width / 2, heightGrip.y - 90, { steps: 8 });
  await page.mouse.up();
  expect((await page.locator(".guidance-reading[data-state=active]").boundingBox())!.height).toBeLessThan(readingBefore - 40);
  await heightDivider.focus();
  await page.keyboard.press("ArrowDown");
  expect(await video.evaluate((element: HTMLVideoElement) => element.currentTime)).toBeCloseTo(3, 1);
});

test("video size keyboard controls keep pause and audio state intact", async ({ page }) => {
  const video = await workspace(page, audioClip);
  await expect(video).toHaveJSProperty("muted", false);
  await video.evaluate((element: HTMLVideoElement) => { element.currentTime = 3; element.volume = .4; });
  await expect.poll(() => video.evaluate((element: HTMLVideoElement) => element.seeking)).toBe(false);
  const controls = await videoSize(page);
  const zoom = controls.getByRole("slider", { name: "Video zoom", exact: true });
  await zoom.focus();
  await zoom.press("ArrowRight");
  await numeric(controls.getByRole("spinbutton", { name: "Zoom percent", exact: true }), 175);
  await expect(page.locator(".video-canvas")).toHaveAttribute("data-video-zoom", "1.75");
  await controls.getByRole("button", { name: "Reset video view", exact: true }).click();
  await page.keyboard.press("Escape");
  await expect(video).toHaveJSProperty("paused", true);
  await expect(video).toHaveJSProperty("muted", false);
  await expect(video).toHaveJSProperty("volume", .4);
  expect(await video.evaluate((element: HTMLVideoElement) => element.currentTime)).toBeCloseTo(3, 1);
  await page.getByRole("button", { name: "Play video", exact: true }).click();
  await expect.poll(() => video.evaluate((element: HTMLVideoElement) => element.currentTime)).toBeGreaterThan(3.1);
  await page.getByRole("button", { name: "Pause video", exact: true }).click();
  await expect(video).toHaveJSProperty("paused", true);
});

test("video editor height changes by number and drag while preserving the mounted source", async ({ page }) => {
  const video = await workspace(page);
  const source = await video.evaluate((element: HTMLVideoElement) => element.currentSrc);
  const extent = page.getByTestId("workspace-editor-extent");
  const controls = await videoSize(page);
  await numeric(controls.getByRole("spinbutton", { name: "Video editor height (px)", exact: true }), 500);
  await checkVideoPopup(page, controls);
  await page.keyboard.press("Escape");
  await expect(controls).toBeHidden();
  await expect.poll(async () => (await extent.boundingBox())!.height).toBeCloseTo(500, 0);
  const divider = page.getByTestId("workspace-editor-height-divider");
  const grip = (await divider.boundingBox())!;
  await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2);
  await page.mouse.down();
  await page.mouse.move(grip.x + grip.width / 2, grip.y - 80, { steps: 8 });
  await page.mouse.up();
  expect((await extent.boundingBox())!.height).toBeLessThan(450);
  expect(await video.evaluate((element: HTMLVideoElement) => element.currentSrc)).toBe(source);
  await expect(video).toHaveJSProperty("paused", true);
  const reset = await videoSize(page);
  await reset.getByRole("button", { name: "Use available height", exact: true }).click();
  await page.keyboard.press("Escape");
  expect((await extent.boundingBox())!.height).toBeGreaterThan(600);
});

test("48px guidance text has readable line spacing and Escape cancels a numeric draft", async ({ page }, testInfo) => {
  await workspace(page);
  const before = await documentSnapshot(page);
  await guidanceSize(page);
  await numeric(page.getByRole("spinbutton", { name: "Guidance text size (px)", exact: true }), 48);
  await page.keyboard.press("Escape");
  const criterion = page.locator(".guidance-reading[data-state=active]").getByText("Red band visible.", { exact: true });
  const metrics = await criterion.evaluate(element => {
    const css = getComputedStyle(element);
    return { font: parseFloat(css.fontSize), line: parseFloat(css.lineHeight), overflow: element.scrollWidth > element.clientWidth + 1 };
  });
  expect(metrics.font).toBe(48);
  expect(metrics.line).toBeGreaterThanOrEqual(metrics.font * 1.4);
  expect(metrics.overflow).toBe(false);
  await guidanceSize(page);
  const width = page.getByRole("spinbutton", { name: "Guidance width (px)", exact: true });
  const saved = await width.inputValue();
  await width.fill("700");
  await width.press("Escape");
  if (!(await width.isVisible())) await guidanceSize(page);
  await expect(width).toHaveValue(saved);
  expect(await documentSnapshot(page)).toEqual(before);
  await numeric(width, 700);
  await page.keyboard.press("Escape");
  await criterion.scrollIntoViewIfNeeded();
  await saveScreenshot(page, testInfo, "editor-large-text-desktop.png");
});

test("320px and enlarged text keep editor controls and guidance inside the page", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 320, height: 850 });
  await workspace(page);
  await page.evaluate(() => { document.documentElement.style.fontSize = "32px"; });
  await guidanceSize(page);
  const guidanceMenu = page.locator(".guidance-sizing-popover");
  await checkPopupBounds(page, guidanceMenu);
  for (const control of [
    ...["Guidance width (px)", "Guidance height (px)", "Guidance text size (px)"].map(name => guidanceMenu.getByRole("spinbutton", { name, exact: true })),
    guidanceMenu.getByRole("button", { name: "Reset layout and text", exact: true }),
  ]) {
    await control.scrollIntoViewIfNeeded();
    await expect(control).toBeVisible();
    const target = (await control.boundingBox())!;
    expect(target.y).toBeGreaterThanOrEqual(0);
    expect(target.y + target.height).toBeLessThanOrEqual(851);
  }
  await numeric(page.getByRole("spinbutton", { name: "Guidance text size (px)", exact: true }), 36);
  await page.keyboard.press("Escape");
  for (const selector of [".workspace-video", ".workspace-guidance", ".guidance-reading[data-state=active]"]) {
    const box = (await page.locator(selector).boundingBox())!;
    expect(box.x, selector).toBeGreaterThanOrEqual(-1);
    expect(box.x + box.width, selector).toBeLessThanOrEqual(321);
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  await page.getByRole("button", { name: "Video size", exact: true }).scrollIntoViewIfNeeded();
  const controls = await videoSize(page);
  await expect(controls.getByRole("spinbutton", { name: "Zoom percent", exact: true })).toBeVisible();
  await checkVideoPopup(page, controls);
  const box = (await controls.boundingBox())!;
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(321);
  await page.keyboard.press("Escape");
  await saveScreenshot(page, testInfo, "editor-320-200-text.png");
});

test("video size controls remain within a short landscape window and scroll to every control", async ({ page }) => {
  await page.setViewportSize({ width: 1000, height: 390 });
  await workspace(page);
  await page.getByRole("button", { name: "Video size", exact: true }).scrollIntoViewIfNeeded();
  const controls = await videoSize(page);
  await checkVideoPopup(page, controls);
  await page.keyboard.press("Escape");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
});

for (const width of [390, 820]) {
  test.describe(`touch editor ${width}`, () => {
    test.use({ viewport: { width, height: 1000 }, hasTouch: true, isMobile: true });
    test("touch divider resizes in its orientation and remains usable after rotation", async ({ page, browserName }, testInfo) => {
      test.skip(browserName !== "chromium", "Real touch drag is sent through the Chromium CDP input API.");
      await workspace(page);
      const divider = page.getByTestId("workspace-editor-divider");
      await divider.scrollIntoViewIfNeeded();
      const grip = (await divider.boundingBox())!;
      const pane = (await page.locator(".workspace-guidance").boundingBox())!;
      await page.evaluate(() => {
        const events: unknown[] = [];
        (window as typeof window & { sizingTouchEvents: unknown[] }).sizingTouchEvents = events;
        for (const type of ["pointerdown", "pointermove", "pointerup", "touchstart", "touchmove", "touchend"]) document.addEventListener(type, event => {
          const pointer = event as PointerEvent;
          events.push({ type, pointerType: pointer.pointerType, x: pointer.clientX, y: pointer.clientY, target: (event.target as HTMLElement)?.closest("[data-testid]")?.getAttribute("data-testid") });
        }, { capture: true });
      });
      const cdp = await page.context().newCDPSession(page);
      const x = grip.x + grip.width / 2;
      const y = grip.y + grip.height / 2;
      await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y }] });
      await expect(divider).toHaveAttribute("data-resize-handle-state", "drag");
      for (let step = 1; step <= 7; step++) {
        await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: x - (width >= 768 ? step * 10 : 0), y: y - (width < 768 ? step * 10 : 0) }] });
        await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => resolve())));
      }
      await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
      await cdp.detach();
      await testInfo.attach("touch-events", { body: JSON.stringify(await page.evaluate(() => (window as typeof window & { sizingTouchEvents: unknown[] }).sizingTouchEvents)), contentType: "application/json" });
      await expect.poll(async () => {
        const resized = (await page.locator(".workspace-guidance").boundingBox())!;
        return width >= 768 ? resized.width : resized.height;
      }, { timeout: 2000 }).toBeGreaterThan((width >= 768 ? pane.width : pane.height) + 30);
      await page.setViewportSize({ width: 1000, height: width });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
      await page.getByRole("button", { name: "Adjust guidance size", exact: true }).scrollIntoViewIfNeeded();
      await guidanceSize(page);
      await expect(page.getByRole("spinbutton", { name: "Guidance text size (px)", exact: true })).toBeEnabled();
    });
  });
}
