import { test, expect } from "@playwright/test";

for (const width of [320, 1440]) {
  test(`official Leica reference at ${width}px loads only on Play and keeps its source accessible`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    const youtubeRequests: string[] = [];
    page.on("request", request => {
      if (/youtube(?:-nocookie)?\.com|ytimg\.com/.test(new URL(request.url()).hostname))
        youtubeRequests.push(request.url());
    });
    // The embedding contract is deterministic; live upstream availability is
    // separately checked without replacing YouTube's player controls.
    await page.route("https://www.youtube-nocookie.com/embed/**", route =>
      route.fulfill({
        contentType: "text/html",
        body: '<html><body style="margin:0;background:#101719;color:white"><p>External video player</p></body></html>',
      }),
    );
    await page.goto("/");
    const launch = page.getByRole("button", { name: "Watch official film" });
    await expect(launch).toBeVisible();
    expect(youtubeRequests).toEqual([]);
    await expect(page.locator("iframe")).toHaveCount(0);
    await launch.click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await expect(page.locator("iframe")).toHaveCount(0);
    expect(youtubeRequests).toEqual([]);
    const source = page.getByRole("link", { name: /Open original on YouTube/ });
    await expect(source).toHaveAttribute("href", "https://www.youtube.com/watch?v=p4t-OVIvuy8");
    await expect(source).toHaveAttribute("rel", "noopener noreferrer");
    await page.getByRole("button", { name: "Play official Leica film" }).click();
    const iframe = page.locator("iframe[title='Official Leica Camera film: Leica M10 assembly']");
    await expect(iframe).toBeVisible();
    await expect(iframe).toHaveAttribute("referrerpolicy", "strict-origin-when-cross-origin");
    await expect.poll(() => youtubeRequests.length).toBe(1);
    expect(youtubeRequests[0]).toMatch(/^https:\/\/www\.youtube-nocookie\.com\/embed\/p4t-OVIvuy8\?/);
    const bounds = await iframe.boundingBox();
    expect(bounds!.width).toBeGreaterThanOrEqual(200);
    expect(bounds!.height).toBeGreaterThanOrEqual(200);
    expect(await iframe.evaluate(element => {
      const rect = element.getBoundingClientRect();
      return document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2) === element;
    })).toBe(true);
    await expect(source).toBeVisible();
    await expect(page.getByText(/If playback is unavailable/)).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.getByRole("button", { name: "Close", exact: true }).click();
    await expect(iframe).toHaveCount(0);
    await expect(launch).toBeFocused();
  });
}
