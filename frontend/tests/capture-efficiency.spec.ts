import { test, expect } from "@playwright/test";
import path from "node:path";

test("paused frames reuse JPEGs; seek/detail changes refresh; hidden pages stop capturing", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.toDataURL;
    Object.assign(window, { __jpegCount: 0, __lastCapturedJpeg: "" });
    HTMLCanvasElement.prototype.toDataURL = function (...args) {
      const encoded = original.apply(this, args);
      if (args[0] === "image/jpeg") {
        const counter = window as Window & {
          __jpegCount: number;
          __lastCapturedJpeg: string;
        };
        counter.__jpegCount++;
        counter.__lastCapturedJpeg = encoded;
      }
      return encoded;
    };
  });
  await page.goto("/");
  await page.getByTestId("intro-document-input").setInputFiles({
    name: "Capture.txt",
    mimeType: "text/plain",
    buffer: Buffer.from(
      "Step 1: Inspect\nActions: Inspect the surface.\nCriteria: Parts visibly on surface.",
    ),
  });
  await expect(page.getByText("Capture.txt · 1 steps extracted")).toBeVisible();
  await page
    .getByTestId("intro-video-input")
    .setInputFiles(path.resolve("../evaluation/assets/parts-sorting.mp4"));
  await page.getByRole("button", { name: "Open workspace" }).click();
  await expect(
    page.getByText("Check the work area before the next documented action.", {
      exact: true,
    }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Pause video", exact: true }).click();
  await expect
    .poll(() =>
      page.locator("video").evaluate((v) => (v as HTMLVideoElement).paused),
    )
    .toBe(true);
  // Set an explicit low-detail baseline. Recognition now defaults to detailed
  // capture, so choosing high again would not change the pixel geometry.
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("combobox", { name: "Visual detail", exact: true }).click();
  await page.getByRole("option", { name: "Fast · broad scene observations", exact: true }).click();
  await page.locator(".app-dialog").getByRole("button", { name: "Close", exact: true }).click();
  // Explicitly capture the newly paused frame instead of assuming a sampler
  // tick at a fixed time: the inactive chat has no background sampling timer.
  const pausedCapture = page.waitForResponse(r => r.url().endsWith("/api/guidance/analyze"));
  await page.getByRole("button", { name: "Analyze current view", exact: true }).click();
  expect((await pausedCapture).ok()).toBe(true);
  const count = () =>
    page.evaluate(
      () => (window as Window & { __jpegCount: number }).__jpegCount,
    );
  const initial = await count();
  expect(initial).toBeGreaterThan(0);
  // Let the paused Guardian's interval elapse; no extra JPEG is needed.
  await page.waitForTimeout(2300);
  expect(await count()).toBe(initial);
  for (let i = 0; i < 2; i++) {
    const response = page.waitForResponse((r) =>
      r.url().endsWith("/api/guidance/analyze"),
    );
    await page
      .getByRole("button", { name: "Analyze current view", exact: true })
      .click();
    expect((await response).ok()).toBe(true);
  }
  expect(await count()).toBe(initial);
  await page
    .getByRole("button", { name: "Next video frame", exact: true })
    .click();
  await expect
    .poll(() =>
      page.locator("video").evaluate((v) => !(v as HTMLVideoElement).seeking),
    )
    .toBe(true);
  await expect.poll(count).toBe(initial + 1);
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page
    .getByRole("combobox", { name: "Visual detail", exact: true })
    .click();
  await page
    .getByRole("option", {
      name: "Detailed · small objects and text",
      exact: true,
    })
    .click();
  await page
    .locator(".app-dialog")
    .getByRole("button", { name: "Close", exact: true })
    .click();
  const response = page.waitForRequest(
    (r) =>
      r.url().endsWith("/api/guidance/analyze") &&
      r.postDataJSON().vision_detail === "high",
  );
  await page
    .getByRole("button", { name: "Analyze current view", exact: true })
    .click();
  const body = (await response).postDataJSON();
  expect(await count()).toBe(initial + 2);
  // Server-owned video now supplies a full trailing window from FFmpeg. The
  // browser still caches its actual JPEG for frame capture and local fallback;
  // inspect the encoded canvas image instead of expecting it in that request.
  expect(body.frames_b64).toEqual([]);
  const dimensions = await page.evaluate(async () => {
    const image = new Image();
    image.src = (
      window as Window & { __lastCapturedJpeg: string }
    ).__lastCapturedJpeg;
    await image.decode();
    return [image.width, image.height];
  });
  expect(dimensions).toEqual([960, 640]);
  await page.getByRole("button", { name: "Play video", exact: true }).click();
  await expect
    .poll(() =>
      page.locator("video").evaluate((v) => (v as HTMLVideoElement).paused),
    )
    .toBe(false);
  await page.evaluate(() => {
    Object.defineProperty(document, "hidden", {
      configurable: true,
      value: true,
    });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  const hiddenCount = await count();
  await page.waitForTimeout(1700);
  expect(await count()).toBe(hiddenCount);
  await page.evaluate(() => {
    Object.defineProperty(document, "hidden", {
      configurable: true,
      value: false,
    });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await expect.poll(count).toBeGreaterThan(hiddenCount);
});
