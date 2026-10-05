import { test, expect, devices } from "@playwright/test";
import path from "node:path";

test.use({ ...devices["iPad Pro 11"], browserName: "webkit", channel: "", launchOptions: {} });
for (const initial of [
  { width: 820, height: 1180 }, { width: 1180, height: 820 },
]) {
  test(`WebKit tablet ${initial.width}px plays real footage, seeks and rotates without remounting`, async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.setViewportSize(initial);
    await page.goto("/");
    await page.getByTestId("intro-document-input").setInputFiles({
      name: "Tablet.txt", mimeType: "text/plain",
      buffer: Buffer.from("Step 1: Inspect parts\nActions: Identify the visible parts and trays.\nCriteria: Parts visible on surface.\nSafety: Check the surrounding area."),
    });
    await expect(page.getByText("Tablet.txt · 1 steps extracted")).toBeVisible();
    await page.getByTestId("intro-video-input").setInputFiles(path.resolve("../evaluation/assets/parts-sorting.mp4"));
    await page.getByRole("button", { name: "Open workspace" }).tap();
    const video = page.locator("video").first();
    await expect.poll(() => video.evaluate((v) => (v as HTMLVideoElement).readyState)).toBeGreaterThanOrEqual(2);
    expect(await video.evaluate((v) => [(v as HTMLVideoElement).videoWidth, (v as HTMLVideoElement).videoHeight])).toEqual([960, 640]);
    await page.evaluate(() => Object.assign(window, { __tabletVideo: document.querySelector("video") }));
    if (await page.getByRole("button", { name: "Pause video", exact: true }).isVisible())
      await page.getByRole("button", { name: "Pause video", exact: true }).tap();
    await page.getByRole("button", { name: "Play video", exact: true }).tap();
    await expect.poll(() => video.evaluate((v) => (v as HTMLVideoElement).currentTime)).toBeGreaterThan(0.4);
    await page.getByRole("button", { name: "Pause video", exact: true }).tap();
    const timeline = page.getByRole("slider", { name: "Video timeline", exact: true });
    await timeline.focus();
    await page.keyboard.press("End");
    await expect.poll(() => video.evaluate((v) => (v as HTMLVideoElement).currentTime)).toBeGreaterThan(15);
    await page.keyboard.press("Home");
    await expect.poll(() => video.evaluate((v) => (v as HTMLVideoElement).currentTime)).toBeLessThan(0.3);
    await page.setViewportSize({ width: initial.height, height: initial.width });
    expect(await page.evaluate(() => document.querySelector("video") === (window as Window & { __tabletVideo?: Element }).__tabletVideo)).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    const stage = await page.locator(".workspace-video").boundingBox();
    const guide = await page.locator(".workspace-guidance").boundingBox();
    expect(guide!.x).toBeGreaterThanOrEqual(stage!.x + stage!.width - 1);
    await page.getByRole("tab", { name: "Principles", exact: true }).tap();
    await expect(page.getByText("Check the surrounding area.", { exact: true }).first()).toBeVisible();
    await page.getByRole("button", { name: "Open chat", exact: true }).tap();
    await page.getByRole("textbox", { name: "Message", exact: true }).fill("What is currently visible?");
    await page.getByRole("button", { name: "Send message", exact: true }).tap();
    await expect(page.getByText("The visible tool is on the table.", { exact: false }).first()).toBeVisible();
    await page.getByRole("button", { name: "Close chat", exact: true }).tap();
    expect(errors).toEqual([]);
    await page.screenshot({ path: `test-results/webkit-tablet-${initial.width}.png`, fullPage: true });
  });
}
