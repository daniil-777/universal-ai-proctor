import { test, expect, type Locator } from "@playwright/test";

async function fullyReachable(control: Locator) {
  await control.scrollIntoViewIfNeeded();
  const bounds = await control.evaluate((element) => {
    const box = element.getBoundingClientRect();
    let top = 0, bottom = innerHeight;
    for (let ancestor = element.parentElement; ancestor; ancestor = ancestor.parentElement) {
      if (!/(auto|scroll|hidden|clip)/.test(getComputedStyle(ancestor).overflowY)) continue;
      const rect = ancestor.getBoundingClientRect();
      top = Math.max(top, rect.top + ancestor.clientTop);
      bottom = Math.min(bottom, rect.top + ancestor.clientTop + ancestor.clientHeight);
    }
    return { top: box.top, bottom: box.bottom, clipTop: top, clipBottom: bottom };
  });
  expect(bounds.top).toBeGreaterThanOrEqual(bounds.clipTop - 1);
  expect(bounds.bottom).toBeLessThanOrEqual(bounds.clipBottom + 1);
}

test("account fields remain fully reachable on a 320px phone with 200% text", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 900 });
  await page.goto("/");
  await page.evaluate(() => { document.documentElement.style.fontSize = "32px"; });
  await page.getByRole("button", { name: "Open workspace", exact: true }).click();
  await page.getByRole("button", { name: "Account and training", exact: true }).click();
  const dialog = page.getByRole("dialog").filter({ has: page.getByRole("heading", { name: "My training workspace", exact: true }) });
  await expect(dialog.getByRole("heading", { name: "Welcome back", exact: true })).toBeVisible();
  const headingFits = async (name: string) => {
    const heading = dialog.getByRole("heading", { name, exact: true });
    await fullyReachable(heading);
    const width = await heading.evaluate(element => ({ visible: element.clientWidth, content: element.scrollWidth }));
    expect(width.content).toBeLessThanOrEqual(width.visible + 1);
  };
  await headingFits("Welcome back");
  for (const control of [dialog.getByRole("button", { name: "Sign in", exact: true }).first(), dialog.getByRole("button", { name: "Create account", exact: true })]) {
    await fullyReachable(control);
    const metrics = await control.evaluate(element => ({ width: element.clientWidth, contentWidth: element.scrollWidth, height: element.clientHeight, contentHeight: element.scrollHeight }));
    expect(metrics.contentWidth).toBeLessThanOrEqual(metrics.width + 1);
    expect(metrics.contentHeight).toBeLessThanOrEqual(metrics.height + 1);
  }
  for (const control of [dialog.getByLabel("Email", { exact: true }), dialog.getByLabel("Password", { exact: true }), dialog.getByRole("button", { name: "Sign in", exact: true }).last()]) {
    await fullyReachable(control);
    await expect(dialog.getByRole("button", { name: "Close", exact: true })).toBeInViewport();
  }
  await dialog.getByRole("button", { name: "Create account", exact: true }).click();
  await headingFits("Create your workspace");
  for (const control of [dialog.getByLabel("Name", { exact: true }), dialog.getByLabel("Email", { exact: true }), dialog.getByLabel("Password", { exact: true }), dialog.getByRole("button", { name: "Create my account", exact: true })]) {
    await fullyReachable(control);
    await expect(dialog.getByRole("button", { name: "Close", exact: true })).toBeInViewport();
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
  await dialog.getByRole("button", { name: "Close", exact: true }).click();
  await expect(dialog).toHaveCount(0);
});
