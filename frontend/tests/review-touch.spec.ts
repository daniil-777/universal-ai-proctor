import { test, expect, devices } from "@playwright/test";
import { setup, tool } from "./review-helpers";
test.use({ browserName: "webkit", channel: "", launchOptions: {} });
for (const device of ["iPhone 13", "iPad Pro 11"] as const) {
  test.describe(`new industry tools on ${device}`, () => {
    const { defaultBrowserType: _browser, ...contextOptions } = devices[device];
    test.use(contextOptions);
    test("touch review, preparation, account and file exports stay usable", async ({
      page,
    }) => {
      const errors: string[] = [];
      page.on("pageerror", (e) => errors.push(e.message));
      await setup(page);
      await tool(page, "Review");
      await page
        .getByLabel("Evidence bookmark note")
        .fill(`${device} captured moment`);
      await page.getByRole("button", { name: "Save frame", exact: true }).tap();
      await expect(
        page
          .getByRole("article")
          .filter({ hasText: `${device} captured moment` }),
      ).toBeVisible();
      await tool(page, "Readiness");
      await page.getByRole("checkbox").first().check();
      await expect(page.getByRole("checkbox").first()).toBeChecked();
      await page.getByRole("button", { name: "Account and training" }).tap();
      const dialog = page.getByRole("dialog");
      await dialog
        .getByRole("button", { name: "Create account", exact: true })
        .tap();
      await dialog.getByLabel("Name", { exact: true }).fill("Mobile Operator");
      await dialog
        .getByLabel("Email", { exact: true })
        .fill(`mobile-${Date.now()}@example.com`);
      await dialog
        .getByLabel("Password", { exact: true })
        .fill("mobile-passphrase-2026");
      await dialog.getByRole("button", { name: "Create my account" }).tap();
      await dialog.getByRole("button", { name: "Save current result" }).tap();
      await expect(dialog.getByRole("article")).toHaveCount(1);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1,
        ),
      ).toBe(true);
      await page.screenshot({
        path: `test-results/industry-${device.replaceAll(" ", "-")}-account.png`,
      });
      await dialog.getByRole("button", { name: "Close", exact: true }).tap();
      await page.getByRole("button", { name: "Sources and setup" }).tap();
      await page.getByRole("button", { name: "Report", exact: true }).tap();
      await page
        .getByRole("button", { name: "Prepare PDF", exact: true })
        .tap();
      await expect(
        page.getByRole("button", { name: "Download PDF", exact: true }),
      ).toBeVisible();
      const download = page.waitForEvent("download");
      await page
        .getByRole("button", { name: "Download PDF", exact: true })
        .tap();
      expect((await download).suggestedFilename()).toMatch(/\.pdf$/);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1,
        ),
      ).toBe(true);
      expect(errors).toEqual([]);
    });
  });
}
