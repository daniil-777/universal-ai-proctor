import { test, expect, Page } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";
const assets = fileURLToPath(new URL("../../evaluation/assets/", import.meta.url));
async function setup(page: Page) {
  await page.goto("/");
  await page.getByTestId("intro-video-input").setInputFiles(path.join(assets, "parts-sorting.mp4"));
  await page.getByTestId("intro-document-input").setInputFiles(path.join(assets, "Parts_Sorting.txt"));
  await expect(page.getByText("Parts_Sorting.txt · 4 steps extracted")).toBeVisible();
}
async function goals(page: Page, text: string) {
  await page.getByRole("button", { name: "Guidance goals", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByLabel("Your wishes for this session")).toBeEnabled();
  await dialog.getByLabel("Your wishes for this session").fill(text);
  await dialog.getByRole("button", { name: "Save goals" }).click();
  await expect(dialog).toBeHidden();
}
test("session wishes survive reload and appear in Guardian and chat prompts without changing steps", async ({ page }) => {
  await setup(page); const wishes = "Explain the principle in French and focus on missed checks.";
  await goals(page, wishes); await page.reload();
  await page.getByRole("button", { name: "Guidance goals", exact: true }).click();
  await expect(page.getByLabel("Your wishes for this session")).toHaveValue(wishes);
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await page.getByTestId("intro-video-input").setInputFiles(path.join(assets, "parts-sorting.mp4"));
  const analyzed = page.waitForResponse(r => r.url().endsWith("/api/guidance/analyze") && r.ok());
  await page.getByRole("button", { name: "Open workspace" }).click();
  const observation = await (await analyzed).json();
  expect(observation.prompt).toContain(wishes); expect(observation.preferences_revision).toBe(1);
  await expect(page.getByTestId("step-S1")).toBeVisible();
  await page.getByRole("button", { name: "Open chat" }).click();
  const answered = page.waitForResponse(r => r.url().endsWith("/api/llm/ask/stream") && r.ok());
  await page.locator(".chat-panel textarea").fill("Explain the principle");
  await page.locator(".chat-panel").getByRole("button", { name: "Send message", exact: true }).click();
  expect(await (await answered).text()).toContain(wishes);
  await expect(page.locator(".chat-panel")).toContainText("The visible tool is on the table.");
});
test("cancel preserves wishes, failed save preserves the draft, and clearing restores standard guidance", async ({ page }) => {
  await page.goto("/"); await goals(page, "Original goals");
  await page.getByRole("button", { name: "Guidance goals", exact: true }).click();
  await page.getByLabel("Your wishes for this session").fill("Discarded draft"); await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await page.getByRole("button", { name: "Guidance goals", exact: true }).click();
  await expect(page.getByLabel("Your wishes for this session")).toHaveValue("Original goals");
  await page.getByLabel("Your wishes for this session").fill("Keep this draft after failure");
  await page.route("**/api/preferences", route => route.request().method() === "PUT" ? route.fulfill({ status: 503, json: { error: "Temporary outage" } }) : route.continue());
  await page.getByRole("button", { name: "Save goals" }).click();
  await expect(page.getByRole("alert")).toContainText("Temporary outage");
  await expect(page.getByLabel("Your wishes for this session")).toHaveValue("Keep this draft after failure");
  await page.unroute("**/api/preferences");
  await page.getByRole("button", { name: "Save goals" }).click(); await expect(page.getByRole("dialog")).toBeHidden();
  await page.getByRole("button", { name: "Guidance goals", exact: true }).click();
  await page.getByRole("button", { name: "Clear wishes" }).click(); await page.getByRole("button", { name: "Save goals" }).click();
  await page.getByRole("button", { name: "Guidance goals", exact: true }).click(); await expect(page.getByLabel("Your wishes for this session")).toHaveValue("");
});
test("changing goals cancels a pending chat answer and a new answer uses the new version", async ({ page }) => {
  await setup(page); await page.getByRole("button", { name: "Open workspace" }).click();
  await page.getByRole("button", { name: "Open chat" }).click();
  let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; });
  await page.route("**/api/llm/ask/stream", async route => { await gate; await route.fulfill({ contentType: "text/event-stream", body: 'data: {"delta":"Stale reply"}\n\ndata: {"done":true}\n\n' }).catch(() => {}); });
  await page.locator(".chat-panel textarea").fill("Old question");
  const sent = page.waitForRequest("**/api/llm/ask/stream"); await page.locator(".chat-panel").getByRole("button", { name: "Send message", exact: true }).click(); await sent;
  await page.getByRole("button", { name: "Close chat" }).click(); await goals(page, "New goal"); release();
  await page.getByRole("button", { name: "Open chat" }).click();
  await expect(page.locator(".chat-panel")).toContainText("guidance goals changed");
  await expect(page.locator(".chat-panel")).not.toContainText("Stale reply");
  await page.unroute("**/api/llm/ask/stream");
  const next = page.waitForRequest("**/api/llm/ask/stream"); await page.locator(".chat-panel textarea").fill("New question");
  await page.locator(".chat-panel").getByRole("button", { name: "Send message", exact: true }).click();
  expect((await next).postDataJSON().preferences_revision).toBe(1);
});
test("guidance resizes independently in both dimensions, persists and resets with keyboard", async ({ page }) => {
  await setup(page); await page.getByRole("button", { name: "Open workspace" }).click();
  const box = page.locator(".resizable-guidance"), handle = page.getByRole("button", { name: "Resize guidance area" });
  const before = (await box.boundingBox())!, grip = (await handle.boundingBox())!;
  await page.mouse.move(grip.x + 22, grip.y + 22); await page.mouse.down(); await page.mouse.move(grip.x - 98, grip.y - 58, { steps: 10 }); await page.mouse.up();
  const after = (await box.boundingBox())!;
  expect(after.width).toBeLessThan(before.width - 50); expect(after.height).toBeGreaterThan(before.height + 20);
  await expect(box).toHaveAttribute("data-resized", "true");
  await page.reload(); await page.getByRole("button", { name: "Open workspace" }).click();
  expect((await box.boundingBox())!.width).toBeCloseTo(after.width, 0);
  await handle.focus(); await page.keyboard.press("Home"); await expect(box).toHaveAttribute("data-resized", "false");
  expect((await box.boundingBox())!.width).toBeGreaterThan(after.width);
});
for (const size of [{ width: 390, height: 844 }, { width: 820, height: 1180 }]) {
  test.describe(`touch ${size.width}`, () => {
    test.use({ viewport: size, hasTouch: true, isMobile: true });
    test("goals dialog and guidance drag fit the viewport through rotation", async ({ page }) => {
      await setup(page); await page.getByRole("button", { name: "Guidance goals", exact: true }).tap();
      const dialog = page.getByRole("dialog"); await expect(dialog.getByLabel("Your wishes for this session")).toBeEnabled();
      await dialog.getByLabel("Your wishes for this session").fill("Guide me in simple language.");
      const modal = (await dialog.boundingBox())!; expect(modal.x).toBeGreaterThanOrEqual(0); expect(modal.x + modal.width).toBeLessThanOrEqual(size.width);
      await dialog.getByRole("button", { name: "Save goals" }).tap(); await page.getByRole("button", { name: "Open workspace" }).tap();
      const handle = page.getByRole("button", { name: "Resize guidance area" }), box = page.locator(".resizable-guidance");
      const initial = (await box.boundingBox())!, h = (await handle.boundingBox())!;
      expect(h.width).toBeGreaterThanOrEqual(44); expect(h.height).toBeGreaterThanOrEqual(44);
      const cdp = await page.context().newCDPSession(page);
      await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: h.x + 20, y: h.y + 20 }] });
      await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: h.x - 65, y: h.y + (size.width < 768 ? 60 : -60) }] });
      await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
      await expect(box).toHaveAttribute("data-resized", "true"); expect((await box.boundingBox())!.width).toBeLessThan(initial.width);
      await page.setViewportSize({ width: size.height, height: size.width });
      await expect(box).toHaveClass(/absolute/);
      const rotated = (await box.boundingBox())!; expect(rotated.x).toBeGreaterThanOrEqual(0); expect(rotated.x + rotated.width).toBeLessThanOrEqual(size.height);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      await page.getByRole("button", { name: "Guidance goals", exact: true }).tap(); await expect(page.getByLabel("Your wishes for this session")).toHaveValue("Guide me in simple language.");
      await page.getByRole("dialog").evaluate(async el => { await Promise.all(el.getAnimations().map(a => a.finished.catch(() => {}))); });
      await page.screenshot({ path: `../docs/screenshots/goals-touch-${size.width}.png` });
    });
  });
}
test("a truncated answer remains marked interrupted and is never sent to speech", async ({ page }) => {
  await setup(page); await page.getByRole("button", { name: "Open workspace" }).click();
  await page.getByRole("button", { name: "Open chat" }).click();
  const spoken: string[] = [];
  await page.route("**/api/tts", route => { spoken.push(route.request().postDataJSON().text); return route.fulfill({ status: 503, json: { error: "Fixture audio unavailable" } }); });
  await page.route("**/api/llm/ask/stream", route => route.fulfill({ contentType: "text/event-stream", body: 'data: {"delta":"An incomplete observation"}\n\n' }));
  await page.locator(".chat-panel").getByRole("button", { name: "Voice answers", exact: true }).click();
  await page.locator(".chat-panel textarea").fill("What do you see?");
  await page.locator(".chat-panel").getByRole("button", { name: "Send message", exact: true }).click();
  await expect(page.locator(".chat-panel")).toContainText("Answer interrupted. Try again.");
  expect(spoken.every(text => text === "Voice answers on.")).toBe(true);
});
test("goals loaded after opening populate the draft and a tablet keyboard keeps Save reachable", async ({ page }) => {
  await page.setViewportSize({ width: 820, height: 1180 });
  await page.addInitScript(() => {
    const viewport = Object.assign(new EventTarget(), { height: window.innerHeight, width: window.innerWidth, offsetTop: 0, offsetLeft: 0, scale: 1 });
    Object.defineProperty(window, "visualViewport", { value: viewport });
    Object.assign(window, { __goalsKeyboard: () => { viewport.height = 360; viewport.offsetTop = 200; viewport.dispatchEvent(new Event("resize")); viewport.dispatchEvent(new Event("scroll")); } });
  });
  let release!: () => void; const gate = new Promise<void>(r => { release = r; });
  await page.route("**/api/preferences", async route => {
    if (route.request().method() === "GET") { await gate; await route.fulfill({ json: { ok: true, operator_goals: "Previously saved wishes", preferences_revision: 0 } }); }
    else await route.continue();
  });
  await page.goto("/"); await page.getByRole("button", { name: "Guidance goals", exact: true }).click();
  await expect(page.getByLabel("Your wishes for this session")).toBeDisabled(); release();
  await expect(page.getByLabel("Your wishes for this session")).toHaveValue("Previously saved wishes");
  await page.evaluate(() => (window as unknown as { __goalsKeyboard: () => void }).__goalsKeyboard());
  await expect.poll(async () => (await page.getByRole("dialog").boundingBox())!.height).toBeLessThanOrEqual(336);
  const modal = (await page.getByRole("dialog").boundingBox())!; expect(modal.y).toBeGreaterThanOrEqual(200); expect(modal.y + modal.height).toBeLessThanOrEqual(560);
  await page.getByRole("button", { name: "Save goals" }).click(); await expect(page.getByRole("dialog")).toBeHidden();
});
