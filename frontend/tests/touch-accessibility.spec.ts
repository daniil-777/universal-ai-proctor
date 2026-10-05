import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";

test.use({ hasTouch: true, isMobile: true });
async function enter(page: Page) {
  await page.goto("/");
  await page.getByTestId("intro-document-input").setInputFiles({
    name: "Touch.txt", mimeType: "text/plain",
    buffer: Buffer.from("Step 1: Inspect\nActions: Inspect the visible tool carefully.\nCriteria: Tool visibly on table.\nSafety: Check the surrounding work area."),
  });
  await expect(page.getByText("Touch.txt · 1 steps extracted")).toBeVisible();
  await page.getByRole("button", { name: "Open workspace" }).tap();
}
async function inside(page: Page, selector: string, height: number, top = 0) {
  const rect = await page.locator(selector).boundingBox();
  expect(rect).not.toBeNull();
  expect(rect!.x).toBeGreaterThanOrEqual(0);
  expect(rect!.x + rect!.width).toBeLessThanOrEqual(page.viewportSize()!.width + 1);
  expect(rect!.y).toBeGreaterThanOrEqual(top - 1);
  expect(rect!.y + rect!.height).toBeLessThanOrEqual(top + height + 1);
}
// The automation cannot open a physical OS keyboard. Emit the same viewport
// resize/scroll signals it produces, including a panned viewport on tablets.
async function installViewport(page: Page) {
  await page.addInitScript(() => {
    const viewport = Object.assign(new EventTarget(), {
      height: window.innerHeight, width: window.innerWidth,
      offsetTop: 0, offsetLeft: 0, scale: 1,
    });
    Object.defineProperty(window, "visualViewport", { value: viewport });
    Object.assign(window, {
      __setViewport(height: number, offsetTop = 0) {
        viewport.height = height;
        viewport.offsetTop = offsetTop;
        viewport.dispatchEvent(new Event("resize"));
        viewport.dispatchEvent(new Event("scroll"));
      },
    });
  });
}
async function setViewport(page: Page, height: number, top = 0) {
  await page.evaluate(({ height, top }) => {
    (window as Window & { __setViewport: (h: number, t: number) => void }).__setViewport(height, top);
  }, { height, top });
  await expect(page.locator("html")).toHaveAttribute("data-virtual-keyboard", "true");
}
test("shared chat stays within a panned software-keyboard viewport", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await installViewport(page);
  await page.goto("/share/touch-test");
  await page.getByRole("textbox", { name: "Message", exact: true }).fill("Explain workflow");
  await setViewport(page, 360, 60);
  await inside(page, ".chat-panel", 360, 60);
  await inside(page, '[aria-label="Send message"]', 360, 60);
  await page.getByRole("button", { name: "Send message", exact: true }).tap();
  await expect(page.getByText("The visible tool is on the table.", { exact: false }).first()).toBeVisible();
});
test("200% text with a phone keyboard preserves readable input and reachable send/voice controls", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await installViewport(page);
  await enter(page);
  await page.addStyleTag({ content: "html { font-size: 32px !important; }" });
  await page.getByRole("button", { name: "Open chat", exact: true }).tap();
  await page.getByRole("textbox", { name: "Message", exact: true }).fill("Explain workflow");
  await setViewport(page, 290, 20);
  expect(await page.getByRole("textbox", { name: "Message" }).evaluate((element) => parseFloat(getComputedStyle(element).fontSize))).toBeGreaterThanOrEqual(32);
  await inside(page, '[aria-label="Message"]', 290, 20);
  await inside(page, '[aria-label="Send message"]', 290, 20);
  await inside(page, '[aria-label="Close chat"]', 290, 20);
  const voice = await page.locator(".chat-panel").getByRole("button", { name: "Listen", exact: true }).boundingBox();
  expect(voice!.y + voice!.height).toBeLessThanOrEqual(311);
  await page.getByRole("button", { name: "Send message", exact: true }).tap();
  await expect(page.getByText("The visible tool is on the table.", { exact: false }).first()).toBeVisible();
  await inside(page, '[aria-label="Close chat"]', 290, 20);
  await page.screenshot({ path: "test-results/large-text-keyboard.png", fullPage: true });
});
for (const size of [
  { name: "small phone", width: 320, height: 568, keyboard: 290, top: 0 },
  { name: "phone", width: 390, height: 844, keyboard: 360, top: 0 },
  { name: "tablet portrait", width: 820, height: 1180, keyboard: 420, top: 80 },
  { name: "tablet landscape", width: 1180, height: 820, keyboard: 340, top: 35 },
]) {
  test(`${size.name}: chat, send and dialogs stay above a software keyboard`, async ({ page }) => {
    await page.setViewportSize(size);
    await installViewport(page);
    await enter(page);
    await page.getByRole("button", { name: "Open chat", exact: true }).tap();
    await page.getByRole("textbox", { name: "Message", exact: true }).fill("Explain the current workflow");
    await setViewport(page, size.keyboard, size.top);
    await inside(page, ".chat-panel", size.keyboard, size.top);
    await inside(page, '[aria-label="Send message"]', size.keyboard, size.top);
    await inside(page, '[aria-label="Message"]', size.keyboard, size.top);
    await page.getByRole("button", { name: "Send message", exact: true }).tap();
    await expect(page.getByText("The visible tool is on the table.", { exact: false }).first()).toBeVisible();
    await page.getByRole("button", { name: "Chat options", exact: true }).tap();
    await expect(page.getByRole("combobox", { name: "Question scope" })).toBeVisible();
    await page.getByRole("combobox", { name: "Question scope" }).tap();
    await page.getByRole("option", { name: "Whole video", exact: true }).tap();
    await expect(page.getByRole("combobox", { name: "Question scope" })).toContainText("Whole video");
    await page.getByRole("button", { name: "Close chat", exact: true }).tap();
    await page.getByRole("button", { name: "Settings", exact: true }).tap();
    await inside(page, ".app-dialog", size.keyboard, size.top);
    const close = page.locator(".app-dialog").getByRole("button", { name: "Close", exact: true });
    const bounds = await close.boundingBox();
    expect(bounds!.height).toBeGreaterThanOrEqual(44);
    expect(bounds!.width).toBeGreaterThanOrEqual(44);
    await close.tap();
    await page.screenshot({ path: `test-results/keyboard-${size.width}.png`, fullPage: true });
  });
}
test("source drawer traps focus, allows nested editors and releases focus after rotation", async ({ page }) => {
  await page.setViewportSize({ width: 820, height: 1180 });
  await enter(page);
  const toggle = page.locator('[aria-label="Sources and setup"]');
  await toggle.tap();
  await expect(page.getByRole("dialog", { name: "Sources & setup", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Close sources", exact: true })).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  expect(await page.evaluate(() => !!document.activeElement?.closest("#sources-panel"))).toBe(true);
  await page.keyboard.press("Tab");
  await expect(page.getByRole("button", { name: "Close sources", exact: true })).toBeFocused();
  expect(await page.locator(".workspace-video").evaluate((element) => (element as HTMLElement).inert)).toBe(true);
  await page.getByRole("button", { name: "Read / edit document", exact: true }).tap();
  await expect(page.locator(".app-dialog")).toBeVisible();
  await page.locator(".app-dialog textarea").fill("Step 1: Inspect\nActions: Inspect the visible tool.");
  await page.keyboard.press("Escape");
  await expect(page.locator(".app-dialog")).toBeHidden();
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  await page.keyboard.press("Escape");
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await expect(toggle).toBeFocused();
  await toggle.tap();
  await page.setViewportSize({ width: 1440, height: 900 });
  await expect(page.locator(".responsive-workspace")).toHaveAttribute("data-sources-open", "false");
  expect(await page.locator(".workspace-video").evaluate((element) => (element as HTMLElement).inert)).toBe(false);
  await page.getByRole("button", { name: "Settings", exact: true }).tap();
  await expect(page.locator(".app-dialog")).toBeVisible();
});
for (const width of [320, 600, 820]) {
  test(`${width}px: large text and reduced motion keep core touch controls usable`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await enter(page);
    await page.addStyleTag({ content: "html { font-size: 32px !important; }" });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    for (const label of ["Sources and setup", "Settings", "Open chat"]) {
      const button = page.getByRole("button", { name: label, exact: true });
      const rect = await button.boundingBox();
      expect(rect!.width).toBeGreaterThanOrEqual(44);
      expect(rect!.height).toBeGreaterThanOrEqual(44);
      expect(rect!.x + rect!.width).toBeLessThanOrEqual(width + 1);
    }
    await page.getByRole("button", { name: "Open chat", exact: true }).tap();
    await page.getByRole("textbox", { name: "Message", exact: true }).fill("Explain workflow");
    await page.getByRole("button", { name: "Send message", exact: true }).tap();
    await expect(page.getByText("The visible tool is on the table.", { exact: false }).first()).toBeVisible();
    expect(await page.locator(".chat-panel").evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
    expect(await page.locator(".chat-panel").evaluate((element) => parseFloat(getComputedStyle(element).animationDuration))).toBeLessThanOrEqual(0.001);
    await page.screenshot({ path: `test-results/large-text-${width}.png`, fullPage: true });
  });
}
