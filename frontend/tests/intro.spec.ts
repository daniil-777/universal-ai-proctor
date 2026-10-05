import { test, expect } from "@playwright/test";
import fs from "node:fs";

test("tour downloads only on request, plays and seeks without becoming the analysis source", async ({
  page,
}) => {
  const requests: string[] = [];
  const errors: string[] = [];
  page.on("request", (r) => requests.push(r.url()));
  page.on("pageerror", (e) => errors.push(e.message));
  const posterResponse = page.waitForResponse((r) =>
    r.url().endsWith("process-guide-tour.jpg"),
  );
  await page.goto("/");
  const poster = await posterResponse;
  expect(poster.status()).toBe(200);
  expect(poster.headers()["content-type"]).toContain("image/jpeg");
  expect((await poster.body()).length).toBeLessThan(45_000);
  await expect(
    page.getByRole("heading", { name: "A clearer view of every step." }),
  ).toBeVisible();
  const video = page.getByTestId("intro-tour-video");
  await expect(video).not.toHaveAttribute("src");
  expect(
    requests.filter((url) => url.includes("process-guide-tour.mp4")),
  ).toHaveLength(0);
  await page
    .getByRole("button", { name: "Play the 20-second app tour" })
    .click();
  await expect
    .poll(() => video.evaluate((v: HTMLVideoElement) => v.currentTime))
    .toBeGreaterThan(0.2);
  expect(
    await video.evaluate((v: HTMLVideoElement) => [
      v.duration,
      v.videoWidth,
      v.videoHeight,
      v.muted,
      v.playsInline,
    ]),
  ).toEqual([20, 960, 600, true, true]);
  await video.evaluate((v: HTMLVideoElement) => {
    v.pause();
    v.currentTime = 12;
  });
  await expect
    .poll(() => video.evaluate((v: HTMLVideoElement) => v.currentTime))
    .toBeCloseTo(12, 0);
  await page.getByRole("button", { name: "Open workspace" }).click();
  await expect(page.getByTestId("intro-tour-video")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Analyze current view", exact: true }),
  ).toBeDisabled();
  expect(
    requests.filter(
      (url) =>
        url.includes("/api/guidance/analyze") ||
        url.includes("/api/video/upload"),
    ),
  ).toHaveLength(0);
  expect(errors).toEqual([]);
  const range = await page.request.get("/media/process-guide-tour.mp4", {
    headers: { Range: "bytes=0-1023" },
  });
  expect(range.status()).toBe(206);
  expect(range.headers()["content-range"]).toMatch(/^bytes 0-1023\/\d+$/);
  expect((await range.body()).length).toBe(1024);
});

test("sample-library requests are cached across intro and workspace", async ({
  page,
}) => {
  let loads = 0;
  page.on("request", (r) => {
    if (r.url().endsWith("/api/samples")) loads++;
  });
  await page.goto("/");
  await expect(
    page.getByRole("combobox", { name: "Choose a sample guidance document" }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "Open workspace" }).click();
  await expect(
    page.getByRole("combobox", { name: "Sample guidance" }),
  ).toBeEnabled();
  expect(loads).toBe(1);
});

test("failed sample loads have a working retry, with custom uploads still available", async ({
  page,
}) => {
  let fail = true;
  await page.route("**/api/samples", (r) =>
    fail
      ? r.fulfill({ status: 503, json: { ok: false, error: "Offline" } })
      : r.continue(),
  );
  await page.goto("/");
  await expect(
    page.getByText("Sample documents could not load."),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Upload guidance", exact: true }),
  ).toBeEnabled();
  fail = false;
  await page.getByRole("button", { name: "Retry samples" }).click();
  const samples = page.getByRole("combobox", {
    name: "Choose a sample guidance document",
  });
  await expect(samples).toBeEnabled();
  await samples.click();
  await expect(page.getByRole("option")).toHaveCount(8);
});

test("tour failure exposes instructions and can be retried", async ({
  page,
}) => {
  let fail = true;
  await page.route("**/media/process-guide-tour.mp4", (r) =>
    fail ? r.fulfill({ status: 404, body: "Unavailable" }) : r.continue(),
  );
  await page.goto("/");
  await page
    .getByRole("button", { name: "Play the 20-second app tour" })
    .click();
  await expect(
    page.getByText("The tour could not play.", { exact: false }),
  ).toBeVisible();
  await page.getByText("Read the quick-start guide", { exact: true }).click();
  await expect(
    page.getByText(
      "Choose a recorded video, connect your camera, or share a screen.",
    ),
  ).toBeVisible();
  fail = false;
  await page.getByRole("button", { name: "Retry tour" }).click();
  await expect
    .poll(() =>
      page
        .getByTestId("intro-tour-video")
        .evaluate((v: HTMLVideoElement) => v.currentTime),
    )
    .toBeGreaterThan(0.2);
});

test("intro theme persists into the workspace and survives blocked storage", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Toggle dark appearance" }).click();
  await expect(page.locator("html")).toHaveClass(/dark/);
  await page.reload();
  await expect(page.locator("html")).toHaveClass(/dark/);
  await page.getByRole("button", { name: "Open workspace" }).click();
  await expect(page.locator("html")).toHaveClass(/dark/);
  await page.addInitScript(() => {
    Storage.prototype.getItem = () => {
      throw new DOMException("Blocked", "SecurityError");
    };
    Storage.prototype.setItem = () => {
      throw new DOMException("Blocked", "SecurityError");
    };
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Toggle dark appearance" }).click();
  await expect(page.locator("html")).toHaveClass(/dark/);
  await page.getByRole("button", { name: "Open workspace" }).click();
  await expect(
    page.getByRole("button", { name: "Settings", exact: true }),
  ).toBeVisible();
});

for (const width of [320, 390, 600, 820, 1440]) {
  test(`intro ${width}px has readable setup at 200% text and no overflow`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: width === 1440 ? 1000 : 900 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/");
    // Navigation can finish before the lazy intro content mounts. Measure the
    // enlarged layout only once its final preferences controls are present.
    await expect(
      page.getByRole("button", { name: "Guidance goals", exact: true }),
    ).toBeVisible();
    if (width === 1440) {
      fs.mkdirSync("../docs/screenshots", { recursive: true });
      await page.screenshot({
        path: "../docs/screenshots/intro-desktop.png",
        fullPage: true,
      });
    }
    await page.evaluate(async () => {
      document.documentElement.style.fontSize = "32px";
      await document.fonts.ready;
    });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    const brandTitle = page.locator(".intro-header .brand-copy > div").first();
    await expect(brandTitle).toHaveText("Process Guide");
    expect(
      await brandTitle.evaluate(
        (element) =>
          element.scrollWidth <= element.clientWidth + 1 &&
          element.scrollHeight <= element.clientHeight + 1,
      ),
    ).toBe(true);
    const theme = page.getByRole("button", {
      name: "Toggle dark appearance",
      exact: true,
    });
    const themeBox = await theme.boundingBox();
    expect(themeBox!.width).toBeGreaterThanOrEqual(44);
    expect(themeBox!.height).toBeGreaterThanOrEqual(44);
    expect(themeBox!.x).toBeGreaterThanOrEqual(0);
    expect(themeBox!.x + themeBox!.width).toBeLessThanOrEqual(width);
    if (width === 320) {
      fs.mkdirSync("../docs/screenshots", { recursive: true });
      await page.screenshot({
        path: "../docs/screenshots/intro-small-phone-200-text.png",
        fullPage: true,
      });
      await page.screenshot({
        path: "../docs/screenshots/intro-small-phone-200-header.png",
      });
      const samples = page.getByRole("combobox", {
        name: "Choose a sample video",
        exact: true,
      });
      await expect(samples).toBeEnabled();
      await samples.click();
      const surgery = page.getByRole("option", {
        name: /Uncomplicated cholecystectomy/,
      });
      await expect(surgery).toContainText("Original default");
      await expect(surgery).toContainText("4:12");
      const optionBox = await surgery.boundingBox();
      expect(optionBox!.x).toBeGreaterThanOrEqual(0);
      expect(optionBox!.x + optionBox!.width).toBeLessThanOrEqual(width);
      expect(
        await surgery.evaluate(
          (element) => element.scrollWidth <= element.clientWidth + 1,
        ),
      ).toBe(true);
      await page.screenshot({
        path: "../docs/screenshots/intro-small-phone-200-source-menu.png",
      });
      await page.keyboard.press("Escape");
      await expect(surgery).toBeHidden();
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
    }
    await expect(
      page.getByRole("button", { name: "Play the 20-second app tour" }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Upload a video" })
      .scrollIntoViewIfNeeded();
    const buttons = await page
      .locator('.intro-page [aria-label="Choose a source"] > button')
      .evaluateAll((els) => els.map((e) => e.getBoundingClientRect().height));
    expect(buttons.every((height) => height >= 44)).toBe(true);
    const enter = page.getByRole("button", { name: "Open workspace" });
    await enter.scrollIntoViewIfNeeded();
    await expect(enter).toBeVisible();
    await enter.click();
    await expect(
      page.getByRole("button", { name: "Settings", exact: true }),
    ).toBeVisible();
  });
}
