import { test, expect, devices } from "@playwright/test";
test.use({ browserName: "webkit", channel: "", launchOptions: {} });
for (const [device, width] of [["iPhone 13", 390], ["iPad Pro 11", 820]] as const) {
  test.describe(device, () => {
    const { defaultBrowserType: _browserType, ...profile } = devices[device];
    test.use(profile);
  test(`WebKit ${width}px plays the silent tour and pauses it when out of view`, async ({ page }) => {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 1180 });
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto("/");
    const video = page.getByTestId("intro-tour-video");
    await page.getByRole("button", { name: "Play the 30-second manufacturing demo" }).tap();
    await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.currentTime)).toBeGreaterThan(0.2);
    // In a tall tablet viewport both setup and the tour can remain visible.
    await page.setViewportSize({ width, height: 600 });
    await page.getByRole("button", { name: "Open workspace" }).scrollIntoViewIfNeeded();
    const bounds = await video.boundingBox();
    expect(bounds!.y + bounds!.height).toBeLessThan(0);
    await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.paused)).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.getByRole("button", { name: "Open workspace" }).tap();
    expect(errors).toEqual([]);
  });
  });
}
