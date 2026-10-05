import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFileSync } from "node:child_process";
const directory = fs.mkdtempSync(
  path.join(os.tmpdir(), "process-guide-touch-"),
);
const video = path.join(directory, "process.mp4");
const document = Buffer.from(
  "Step 1: Prepare\nActions: Place the tool on the table.\nCriteria: Tool visibly on table.\nStep 2: Finish\nActions: Put the tool away.\nCriteria: Tool visibly stored.\nSafety: Always check the work area.",
);
test.beforeAll(() =>
  execFileSync("ffmpeg", [
    "-loglevel",
    "error",
    "-f",
    "lavfi",
    "-i",
    "testsrc2=s=1280x720:r=12",
    "-t",
    "15",
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    "-y",
    video,
  ]),
);
test.afterAll(() => fs.rmSync(directory, { recursive: true, force: true }));
async function enter(page: Page, media = true) {
  await page.goto("/");
  await page.getByTestId("intro-document-input").setInputFiles({
    name: "Assembly.txt",
    mimeType: "text/plain",
    buffer: document,
  });
  await expect(
    page.getByText("Assembly.txt · 2 steps extracted"),
  ).toBeVisible();
  if (media) await page.getByTestId("intro-video-input").setInputFiles(video);
  await page.getByRole("button", { name: "Open workspace" }).click();
  await expect(page.getByTestId("step-S1")).toBeVisible();
}
async function noOverflow(page: Page) {
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth + 1,
    ),
  ).toBe(true);
}
for (const device of [
  { name: "small-phone", width: 320, height: 568 },
  { name: "iphone-size", width: 390, height: 844 },
  { name: "android-size", width: 412, height: 915 },
  { name: "phone-landscape", width: 740, height: 390 },
  { name: "small-tablet", width: 600, height: 960 },
  { name: "ipad-air", width: 820, height: 1180 },
  { name: "tablet-portrait", width: 768, height: 1024 },
  { name: "tablet-landscape", width: 1024, height: 768 },
  { name: "large-tablet", width: 1180, height: 820 },
]) {
  test.describe(device.name, () => {
    test.use({
      viewport: { width: device.width, height: device.height },
      isMobile: true,
      hasTouch: true,
    });
    test("video, touch navigation, steps, settings and chat fit the viewport", async ({
      page,
    }) => {
      const errors: string[] = [];
      page.on("pageerror", (e) => errors.push(e.message));
      await page.addInitScript(() => {
        const encode = HTMLCanvasElement.prototype.toDataURL;
        Object.assign(window, { __lastCapturedJpeg: "" });
        HTMLCanvasElement.prototype.toDataURL = function (...args) {
          const result = encode.apply(this, args);
          if (args[0] === "image/jpeg")
            (
              window as Window & { __lastCapturedJpeg: string }
            ).__lastCapturedJpeg = result;
          return result;
        };
      });
      await enter(page);
      await expect(
        page.getByText(
          "Check the work area before the next documented action.",
          { exact: true },
        ),
      ).toBeVisible();
      await noOverflow(page);
      await page.evaluate(() => {
        (
          window as Window & { __mountedVideo?: Element | null }
        ).__mountedVideo = document.querySelector("video");
      });
      const stage = await page.locator(".workspace-video").boundingBox();
      const guidance = await page.locator(".workspace-guidance").boundingBox();
      if (device.width >= 768 || device.width > device.height)
        expect(guidance!.x).toBeGreaterThan(stage!.x + stage!.width - 2);
      else expect(guidance!.y).toBeGreaterThan(stage!.y);
      const setup = page.getByRole("button", { name: "Sources and setup" });
      await setup.tap();
      await expect(
        page.getByRole("button", { name: "Upload video", exact: true }),
      ).toBeVisible();
      await expect(
        page.getByRole("button", { name: "Pause guidance", exact: true }),
      ).toBeVisible();
      const touchTarget = await page
        .getByRole("button", { name: "Upload video", exact: true })
        .boundingBox();
      expect(touchTarget!.height).toBeGreaterThanOrEqual(44);
      await page
        .getByRole("button", { name: "Close sources", exact: true })
        .tap();
      await expect(setup).toHaveAttribute("aria-expanded", "false");
      expect(
        await page.evaluate(
          () =>
            document.querySelector("video") ===
            (window as Window & { __mountedVideo?: Element | null })
              .__mountedVideo,
        ),
      ).toBe(true);
      await page.getByRole("tab", { name: "Principles", exact: true }).tap();
      await expect(
        page.getByText("Always check the work area.", { exact: true }),
      ).toBeVisible();
      await page.getByRole("tab", { name: "Guardian", exact: true }).tap();
      await expect(
        page.getByRole("button", { name: "all checks", exact: true }),
      ).toBeVisible();
      await noOverflow(page);
      const history = page.getByRole("tabpanel", {
        name: "Guardian",
        exact: true,
      });
      expect(
        await history.evaluate(
          (element) => element.scrollWidth <= element.clientWidth + 1,
        ),
      ).toBe(true);
      await page.getByRole("tab", { name: "Steps", exact: true }).tap();
      await expect(
        page.getByRole("progressbar", {
          name: "Confirmed process steps",
          exact: true,
        }),
      ).toHaveAttribute("aria-valuenow", /\d+/);
      await page.getByRole("button", { name: "Settings", exact: true }).tap();
      const dialog = page.getByRole("dialog");
      await expect(dialog).toBeVisible();
      const rect = await dialog.boundingBox();
      expect(rect!.x).toBeGreaterThanOrEqual(0);
      expect(rect!.x + rect!.width).toBeLessThanOrEqual(device.width + 1);
      expect(rect!.height).toBeLessThanOrEqual(device.height);
      await page
        .getByRole("combobox", { name: "Visual detail", exact: true })
        .tap();
      await page
        .getByRole("option", {
          name: "Detailed · small objects and text",
          exact: true,
        })
        .tap();
      await dialog.getByRole("button", { name: "Close", exact: true }).tap();
      await expect(dialog).toBeHidden();
      const detailed = page.waitForRequest(
        (req) =>
          req.url().endsWith("/api/guidance/analyze") &&
          req.postDataJSON()?.vision_detail === "high",
      );
      await page
        .getByRole("button", { name: "Analyze current view", exact: true })
        .tap();
      const detailBody = (await detailed).postDataJSON();
      expect(detailBody.compress).toBe(false);
      expect(detailBody.frames_b64).toEqual([]);
      expect(detailBody.frame_times_s).toEqual([]);
      expect(detailBody.n_samples).toBe(9);
      // The complete window comes from the server-owned video. Its empty
      // request image list should not be decoded as a browser JPEG; the actual
      // canvas capture still demonstrates responsive high-detail geometry.
      const pixels = await page.evaluate(async () => {
        const image = new Image();
        image.src = (
          window as Window & { __lastCapturedJpeg: string }
        ).__lastCapturedJpeg;
        await image.decode();
        return image.naturalWidth;
      });
      expect(pixels).toBe(1280);
      await page
        .getByRole("button", { name: "Video view controls", exact: true })
        .tap();
      await expect(page.getByTitle("Zoom in", { exact: true })).toBeVisible();
      await page.getByTitle("Zoom in", { exact: true }).tap();
      await page.getByTitle("Fit to panel", { exact: true }).tap();
      await page.keyboard.press("Escape");
      await page
        .getByRole("button", { name: "More guidance tools", exact: true })
        .tap();
      await page.getByRole("menuitem", { name: "Metrics", exact: true }).tap();
      await expect(
        page.getByText("Last observation", { exact: false }).first(),
      ).toBeVisible();
      await page.getByRole("tab", { name: "Steps", exact: true }).tap();
      await page.getByRole("button", { name: "Open chat", exact: true }).tap();
      const chat = page.locator(".chat-panel");
      const chatRect = await chat.boundingBox();
      expect(chatRect!.x).toBeGreaterThanOrEqual(0);
      expect(chatRect!.x + chatRect!.width).toBeLessThanOrEqual(
        device.width + 1,
      );
      await page.getByPlaceholder(/Ask about/).fill("What is visible?");
      await page
        .getByRole("button", { name: "Send message", exact: true })
        .tap();
      await expect(
        page
          .getByText("The visible tool is on the table.", { exact: false })
          .first(),
      ).toBeVisible();
      await page.getByRole("button", { name: "Close chat", exact: true }).tap();
      await noOverflow(page);
      expect(errors).toEqual([]);
      await page.screenshot({
        path: `test-results/${device.name}.png`,
        fullPage: true,
      });
    });
  });
}
test.describe("phone camera and rotation", () => {
  test.use({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  test("camera stays attached during rotation, source navigation and touch message resizing", async ({
    page,
    context,
  }) => {
    await context.grantPermissions(["camera", "microphone"]);
    await page.addInitScript(() => {
      Object.defineProperty(navigator.mediaDevices, "getDisplayMedia", {
        value: undefined,
        configurable: true,
      });
    });
    await enter(page, false);
    await page.getByRole("button", { name: "Sources and setup" }).tap();
    await page.getByRole("button", { name: "Camera", exact: true }).tap();
    await page
      .getByRole("button", { name: "Close sources", exact: true })
      .tap();
    await expect(page.locator("video")).toHaveJSProperty("readyState", 4);
    await expect(
      page.getByText("Test fixture: review the visible work area.", {
        exact: true,
      }),
    ).toBeVisible();
    const original = await page
      .locator("video")
      .evaluate((v: HTMLVideoElement) => (v.srcObject as MediaStream).id);
    const box = page.locator(
      '[data-guardian-message="Guardian safety message"]',
    );
    const before = await box.boundingBox();
    const grip = await page
      .getByRole("button", {
        name: "Resize Guardian safety message",
        exact: true,
      })
      .boundingBox();
    const client = await context.newCDPSession(page);
    await client.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [{ x: grip!.x + 18, y: grip!.y + 18 }],
    });
    await client.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [{ x: grip!.x - 50, y: grip!.y + 10 }],
    });
    await client.send("Input.dispatchTouchEvent", {
      type: "touchEnd",
      touchPoints: [],
    });
    await expect
      .poll(async () => (await box.boundingBox())!.width)
      .toBeLessThan(before!.width);
    await client.detach();
    await page
      .getByRole("button", { name: "Record session", exact: true })
      .tap();
    await expect(
      page.getByRole("button", { name: "Stop recording", exact: true }),
    ).toHaveText(/1s/);
    const download = page.waitForEvent("download");
    await page
      .getByRole("button", { name: "Stop recording", exact: true })
      .tap();
    const recording = await download;
    const file = await recording.path();
    expect(fs.statSync(file!).size).toBeGreaterThan(500);
    expect(
      await page
        .locator("video")
        .evaluate((v: HTMLVideoElement) => (v.srcObject as MediaStream).id),
    ).toBe(original);

    await page.setViewportSize({ width: 844, height: 390 });
    await noOverflow(page);
    expect(
      await page
        .locator("video")
        .evaluate((v: HTMLVideoElement) => (v.srcObject as MediaStream).id),
    ).toBe(original);
    await page.getByRole("button", { name: "Sources and setup" }).tap();
    await page
      .getByRole("button", { name: "Stop live input", exact: true })
      .tap();
    await page
      .getByRole("button", { name: "Close sources", exact: true })
      .tap();
    await expect(
      page.getByRole("button", { name: "Stop live input", exact: true }),
    ).toHaveCount(0);
  });
});
