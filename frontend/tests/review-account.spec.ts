import { test, expect } from "@playwright/test";
import fs from "node:fs/promises";
import { setup, tool, api } from "./review-helpers";

test("bookmarks replay their source time, survive rewind and exceptions preserve workflow", async ({
  page,
}) => {
  await setup(page);
  await tool(page, "Review");
  const video = page.locator("video").first();
  const seek = page.waitForResponse(
    (r) => r.url().includes("/api/workflow/seek") && r.ok(),
  );
  await video.evaluate((v) => {
    (v as HTMLVideoElement).pause();
    (v as HTMLVideoElement).currentTime = 6;
  });
  await seek;
  // The API can acknowledge the timeline before the browser decodes the sought frame.
  await expect
    .poll(() =>
      video.evaluate((element) => {
        const media = element as HTMLVideoElement;
        return (
          !media.seeking &&
          media.readyState >= 2 &&
          Math.abs(media.currentTime - 6) < 0.1
        );
      }),
    )
    .toBe(true);
  await page
    .getByLabel("Evidence bookmark note")
    .fill("Inspect the exact assembly moment");
  await page.getByRole("button", { name: "Save frame", exact: true }).click();
  const evidence = page
    .getByRole("article")
    .filter({ hasText: "Inspect the exact assembly moment" });
  await expect(
    evidence.getByRole("img", { name: /Captured evidence/ }),
  ).toBeVisible();
  await video.evaluate((v) => {
    (v as HTMLVideoElement).currentTime = 1;
  });
  await evidence.getByRole("button", { name: "Replay moment" }).click();
  await expect
    .poll(() => video.evaluate((v) => (v as HTMLVideoElement).currentTime))
    .toBeCloseTo(6, 0);
  await page.evaluate(() =>
    window.dispatchEvent(
      new CustomEvent("guidance-review-seek", {
        detail: { sourceId: "unrelated-source", timeS: 12 },
      }),
    ),
  );
  expect(
    await video.evaluate((v) => (v as HTMLVideoElement).currentTime),
  ).toBeCloseTo(6, 0);
  await page.getByRole("button", { name: /^Exceptions/ }).click();
  await page
    .getByLabel("New exception title")
    .fill("Tool calibration needs review");
  await page
    .getByRole("button", { name: "Raise exception", exact: true })
    .click();
  const issue = page
    .getByRole("article")
    .filter({ hasText: "Tool calibration needs review" });
  await expect(issue).toBeVisible();
  const before = (await api(page, "/api/session")).workflow;
  await issue
    .getByLabel("Review note for Tool calibration needs review")
    .fill("Checked the calibration record with the operator.");
  await issue.getByRole("button", { name: "Resolve with note" }).click();
  await page.getByLabel("Include resolved issues").check();
  await expect(issue).toContainText("resolved");
  expect((await api(page, "/api/session")).workflow).toEqual(before);
  await page.getByRole("button", { name: /^Evidence/ }).click();
  await expect(evidence).toBeVisible();
});
test("readiness context and operator checks survive reload and never confirm steps", async ({
  page,
}) => {
  await setup(page);
  await tool(page, "Readiness");
  await page.getByLabel("Work order", { exact: true }).fill("WO-1024");
  await page.getByLabel("Asset / workstation").fill("Assembly station A");
  await page.getByLabel("Operator name").fill("Alex");
  await page.getByRole("button", { name: "Save job context" }).click();
  const check = page.getByRole("checkbox").first();
  await expect(check).toBeEnabled();
  const before = (await api(page, "/api/session")).workflow;
  await check.check();
  await expect(page.getByText("Checked by Alex").first()).toBeVisible();
  expect((await api(page, "/api/session")).workflow).toEqual(before);
  await page.reload();
  await page.getByRole("button", { name: "Open workspace" }).click();
  await tool(page, "Readiness");
  await expect(page.getByLabel("Work order", { exact: true })).toHaveValue(
    "WO-1024",
  );
  await expect(page.getByRole("checkbox").first()).toBeChecked();
});
test("account saves unique results, reloads, downloads a real PDF and isolates a new sign-in", async ({
  page,
}) => {
  await setup(page);
  await page.getByRole("button", { name: "Account and training" }).click();
  const dialog = page.getByRole("dialog");
  await dialog
    .getByRole("button", { name: "Create account", exact: true })
    .click();
  const email = `test-${Date.now()}@example.com`;
  await dialog.getByLabel("Name", { exact: true }).fill("Training Operator");
  await dialog.getByLabel("Email", { exact: true }).fill(email);
  await dialog
    .getByLabel("Password", { exact: true })
    .fill("long-passphrase-2026");
  await dialog.getByRole("button", { name: "Create my account" }).click();
  await expect(
    dialog.getByRole("button", { name: "Save current result" }),
  ).toBeEnabled();
  await dialog.getByRole("button", { name: "Save current result" }).click();
  await expect(dialog.getByRole("article")).toHaveCount(1);
  await dialog.getByRole("button", { name: "Save current result" }).click();
  await expect(dialog.getByRole("article")).toHaveCount(1);
  const download = page.waitForEvent("download");
  await dialog.getByRole("button", { name: "PDF", exact: true }).click();
  const saved = await download;
  expect(
    (await fs.readFile((await saved.path())!)).subarray(0, 5).toString(),
  ).toBe("%PDF-");
  const htmlDownload = page.waitForEvent("download");
  await dialog
    .getByRole("button", { name: "Offline HTML", exact: true })
    .click();
  const savedHtml = await fs.readFile(
    (await (await htmlDownload).path())!,
    "utf8",
  );
  expect(savedHtml).toContain("Readiness.txt");
  expect(savedHtml).toContain("Progress and verification");
  await page.keyboard.press("Escape");
  await page.reload();
  await page.getByRole("button", { name: "Open workspace" }).click();
  await page.getByRole("button", { name: "Account and training" }).click();
  await expect(page.getByRole("dialog").getByRole("article")).toHaveCount(1);
  await dialog.getByRole("button", { name: "Sign out" }).click();
  await expect(dialog.getByLabel("Email", { exact: true })).toBeVisible();
  await dialog
    .getByRole("button", { name: "Create account", exact: true })
    .click();
  await dialog.getByLabel("Name", { exact: true }).fill("Another Operator");
  await dialog
    .getByLabel("Email", { exact: true })
    .fill(`another-${Date.now()}@example.com`);
  await dialog
    .getByLabel("Password", { exact: true })
    .fill("different-passphrase-2026");
  await dialog.getByRole("button", { name: "Create my account" }).click();
  await expect(
    dialog.getByText(/Your saved runs will appear here/),
  ).toBeVisible();
  await expect(dialog.getByRole("article")).toHaveCount(0);
});
test("shareable PDF and offline HTML export contain real analysis, use native file share and fit small screens", async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "canShare", {
      value: () => true,
      configurable: true,
    });
    Object.defineProperty(navigator, "share", {
      value: async (data: ShareData) => {
        (
          window as Window & {
            sharedFile?: { name: string; type: string; size: number };
          }
        ).sharedFile = {
          name: data.files![0].name,
          type: data.files![0].type,
          size: data.files![0].size,
        };
      },
      configurable: true,
    });
  });
  await setup(page);
  await page.getByRole("button", { name: "Report", exact: true }).click();
  await page.getByRole("button", { name: "Prepare PDF", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Download PDF", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Share PDF", exact: true }).click();
  const shared = await page.evaluate(
    () =>
      (window as Window & { sharedFile?: { type: string; size: number } })
        .sharedFile,
  );
  expect(shared.type).toBe("application/pdf");
  expect(shared.size).toBeGreaterThan(10000);
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Offline HTML", exact: true }).click();
  const html = await fs.readFile((await (await download).path())!, "utf8");
  expect(html).toContain("Readiness.txt");
  expect(html).toContain("Progress and verification");
  expect(html).not.toMatch(/<script|https?:\/\/[^<]+\.js/);
  const preview = await page.context().newPage();
  await preview.setViewportSize({ width: 390, height: 844 });
  await preview.setContent(html);
  expect(
    await preview.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
  ).toBe(true);
  await expect(
    preview.getByRole("heading", { name: "Progress and verification" }),
  ).toBeVisible();
  await preview.close();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => { window.open = () => null; });
  await page.getByRole("button", { name: "Detailed session print" }).click();
  await expect(page.getByRole("alert")).toContainText("Print window was blocked");
  await expect(page.getByRole("button", { name: "Close", exact: true })).toBeInViewport();
  expect(await page.getByRole("dialog").evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
});
