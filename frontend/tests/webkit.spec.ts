import { test, expect, devices } from "@playwright/test";
import type { Page } from "@playwright/test";
async function noOverflow(page: Page) {
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth + 1,
    ),
  ).toBe(true);
}
test.use({
  ...devices["iPhone 13"],
  browserName: "webkit",
  channel: "",
  launchOptions: {},
  viewport: { width: 390, height: 844 },
});
test("onboarding, document guidance, settings and chat work in WebKit", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await page.getByTestId("intro-document-input").setInputFiles({
    name: "Assembly.txt",
    mimeType: "text/plain",
    buffer: Buffer.from(
      "Step 1: Prepare\nActions: Place the tool on the table.\nCriteria: Tool visibly on table.",
    ),
  });
  await expect(
    page.getByText("Assembly.txt · 1 steps extracted"),
  ).toBeVisible();
  await page.getByRole("button", { name: "Open workspace" }).tap();
  await noOverflow(page);
  await page.getByRole("button", { name: "Sources and setup" }).tap();
  await page
    .getByRole("button", { name: "Read / edit document", exact: true })
    .tap();
  await expect(page.locator(".app-dialog")).toBeVisible();
  await expect(page.locator("textarea")).toHaveValue(/Place the tool/);
  await page
    .locator(".app-dialog")
    .getByRole("button", { name: "Close", exact: true })
    .tap();
  await page.getByRole("button", { name: "Close sources", exact: true }).tap();
  await page.getByRole("button", { name: "Open chat", exact: true }).tap();
  await page.getByPlaceholder(/Ask about/).fill("Explain the current workflow");
  await page.getByRole("button", { name: "Send message", exact: true }).tap();
  await expect(
    page
      .getByText("The visible tool is on the table.", { exact: false })
      .first(),
  ).toBeVisible();
  await page.getByRole("button", { name: "Close chat", exact: true }).tap();
  await noOverflow(page);
  expect(errors).toEqual([]);
  await page.screenshot({
    path: "test-results/webkit-phone.png",
    fullPage: true,
  });
});
