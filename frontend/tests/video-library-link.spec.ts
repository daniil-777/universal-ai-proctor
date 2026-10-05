import { expect, test } from "@playwright/test";

test.use({ viewport: { width: 320, height: 844 }, hasTouch: true });

test("opens the five real videos with instructions from the phone setup page", async ({ page }) => {
  await page.goto("/");
  const link = page.getByRole("link", { name: "Videos & instructions", exact: true });
  await expect(link).toBeVisible();
  const box = await link.boundingBox();
  expect(box!.height).toBeGreaterThanOrEqual(44);
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(320);
  const popupPromise = page.waitForEvent("popup");
  await link.click();
  const gallery = await popupPromise;
  await gallery.waitForLoadState("networkidle");
  await expect(gallery).toHaveURL(/\/media\/process-guide-real-scenarios\/index\.html$/);
  await expect(gallery.locator("video")).toHaveCount(5);
  await expect(gallery.getByRole("link", { name: "Guidance TXT", exact: true })).toHaveCount(5);
  await expect(gallery.getByRole("link", { name: /Gemini|review prompt/i })).toHaveCount(0);
  expect(await gallery.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  await expect(page.getByRole("button", { name: "Open workspace", exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  await gallery.close();
});
