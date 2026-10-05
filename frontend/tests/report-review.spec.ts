import { chromium, expect, test, type Page, webkit } from "@playwright/test";
import fs from "node:fs/promises";
import { api, setup, tool } from "./review-helpers";

const bookmarkNote = "Check the captured tool placement before releasing work.";
const openIssue = "Measurement record still needs supervisor review";
const resolvedIssue = "Packaging label checked with operator";
const resolutionNote = "Read the actual label and matched the work order.";

async function pauseGuidance(page: Page) {
  const pause = page.getByRole("button", {
    name: "Pause guidance",
    exact: true,
  });
  if (await pause.isVisible()) await pause.click();
  else {
    await page.getByRole("button", { name: "Sources and setup" }).click();
    if (await pause.isVisible()) await pause.click();
    await page
      .getByRole("button", { name: "Close sources", exact: true })
      .click();
  }
  await page
    .locator("video")
    .first()
    .evaluate((element) => (element as HTMLVideoElement).pause());
}

async function prepareReview(page: Page) {
  await setup(page);
  await tool(page, "Review");
  await page.getByLabel("Evidence bookmark note").fill(bookmarkNote);
  await page.getByRole("button", { name: "Save frame", exact: true }).click();
  await expect(
    page.getByRole("article").filter({ hasText: bookmarkNote }),
  ).toBeVisible();
  await page.getByRole("button", { name: /^Exceptions/ }).click();
  for (const title of [openIssue, resolvedIssue]) {
    await page.getByLabel("New exception title").fill(title);
    await page
      .getByRole("button", { name: "Raise exception", exact: true })
      .click();
    await expect(
      page.getByRole("article").filter({ hasText: title }),
    ).toBeVisible();
  }
  const resolved = page.getByRole("article").filter({ hasText: resolvedIssue });
  await resolved
    .getByLabel(`Review note for ${resolvedIssue}`)
    .fill(resolutionNote);
  await resolved
    .getByRole("button", { name: "Resolve with note", exact: true })
    .click();
  await expect(resolved).toHaveCount(0);
  await tool(page, "Readiness");
  await page.getByRole("checkbox").first().check();
  await tool(page, "Steps");
  await page
    .getByRole("button", { name: "Confirm Prepare manually", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Reset Prepare manually", exact: true }),
  ).toBeVisible();

  // Start with a fresh React store: visiting Review above intentionally fetched
  // photos for that workbench, which should not mask the report's lazy loading.
  await page.reload();
  await page
    .getByRole("button", { name: "Open workspace", exact: true })
    .click();
  await expect
    .poll(() =>
      page
        .locator("video")
        .first()
        .evaluate((element) => (element as HTMLVideoElement).readyState),
    )
    .toBeGreaterThanOrEqual(2);
  await pauseGuidance(page);
  return api(page, "/api/review?include_images=false");
}

async function openReport(page: Page) {
  const report = page.getByRole("button", { name: "Report", exact: true });
  if (!(await report.isVisible()))
    await page.getByRole("button", { name: "Sources and setup" }).click();
  await report.click();
  const dialog = page.getByRole("dialog");
  await expect(
    dialog.getByRole("heading", { name: "Session report", exact: true }),
  ).toBeVisible();
  return dialog;
}

async function fitsViewport(page: Page) {
  await expect(
    page
      .getByRole("dialog")
      .getByRole("button", { name: "Close", exact: true }),
  ).toBeInViewport();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
  ).toBe(true);
  expect(
    await page
      .getByRole("dialog")
      .evaluate((element) => element.scrollWidth <= element.clientWidth + 1),
  ).toBe(true);
}

const profiles = [
  {
    name: "desktop",
    browserName: "chromium" as const,
    channel: "chrome",
    viewport: { width: 1440, height: 1000 },
    isMobile: false,
    hasTouch: false,
  },
  {
    name: "320 px phone",
    browserName: "chromium" as const,
    channel: "chrome",
    viewport: { width: 320, height: 740 },
    isMobile: true,
    hasTouch: true,
  },
  {
    name: "tablet",
    browserName: "webkit" as const,
    channel: "",
    viewport: { width: 820, height: 1180 },
    isMobile: true,
    hasTouch: true,
    launchOptions: {},
  },
];

// Tests below exercise the compiled app and real fixture API, with no provider
// requests. Selectors follow the visible report navigation and review controls.
for (const profile of profiles) {
  test.describe(`report review on ${profile.name}`, () => {
    test("priorities, evidence and decisions remain scoped, lazy and keyboard accessible", async ({
      baseURL,
    }, testInfo) => {
      const browser =
        profile.browserName === "webkit"
          ? await webkit.launch({ channel: "", args: [], headless: true })
          : await chromium.launch({ channel: "chrome", headless: true });
      const context = await browser.newContext({
        baseURL,
        viewport: profile.viewport,
        isMobile: profile.isMobile,
        hasTouch: profile.hasTouch,
      });
      const page = await context.newPage();
      try {
        const review = await prepareReview(page);
        const workflowBefore = (await api(page, "/api/session")).workflow;
        const errors: string[] = [];
        const providerRequests: string[] = [];
        const imageReads: string[] = [];
        page.on("pageerror", (error) => errors.push(error.message));
        page.on("request", (request) => {
          const url = new URL(request.url());
          if (
            /^\/api\/(?:guidance\/analyze|analyze|ask|guardian|monitor|listen|tts|compare)(?:\/|$)/.test(
              url.pathname,
            )
          )
            providerRequests.push(url.pathname);
          if (
            url.pathname === "/api/review" &&
            url.searchParams.get("include_images") === "true"
          )
            imageReads.push(request.url());
        });
        const dialog = await openReport(page);
        const nav = dialog.getByRole("navigation", {
          name: "Report sections",
          exact: true,
        });
        const priorities = dialog.getByRole("region", {
          name: "Review priorities",
          exact: true,
        });
        await expect(
          priorities.getByRole("button", {
            name: "Review open issues",
            exact: true,
          }),
        ).toBeVisible();
        await expect(
          priorities.getByRole("button", {
            name: "Review criteria need review",
            exact: true,
          }),
        ).toBeVisible();
        await expect(
          priorities.getByRole("button", {
            name: "Review preparation remaining",
            exact: true,
          }),
        ).toBeVisible();
        await fitsViewport(page);
        expect(imageReads).toEqual([]);

        await priorities
          .getByRole("button", {
            name: "Review criteria need review",
            exact: true,
          })
          .click();
        const workflow = dialog.getByRole("region", {
          name: "Workflow evidence",
          exact: true,
        });
        await expect(workflow).toBeFocused();
        await expect(workflow).toContainText("Manual confirmation");
        await expect(workflow).toContainText("Tool visibly stored.");
        await fitsViewport(page);

        await nav.getByRole("button", { name: "Issues", exact: true }).click();
        const issues = dialog.getByRole("region", {
          name: "Open review issues",
          exact: true,
        });
        await expect(issues).toBeFocused();
        await expect(
          issues.getByText(openIssue, { exact: true }),
        ).toBeVisible();
        await expect(
          issues.getByText(resolvedIssue, { exact: true }),
        ).toHaveCount(0);
        await issues
          .getByLabel("Include resolved report issues", { exact: true })
          .check();
        await expect(
          issues.getByText(resolvedIssue, { exact: true }),
        ).toBeVisible();
        await issues.getByText("Decision history (2)", { exact: true }).click();
        await expect(
          issues.getByText(resolutionNote, { exact: true }),
        ).toBeVisible();
        await fitsViewport(page);

        await nav
          .getByRole("button", { name: "Evidence", exact: true })
          .click();
        const evidence = dialog.getByRole("region", {
          name: "Recorded evidence",
          exact: true,
        });
        await expect(evidence).toBeFocused();
        await expect(
          evidence.getByText(bookmarkNote, { exact: true }),
        ).toBeVisible();
        await expect(evidence.locator("img")).toHaveCount(0);
        await evidence
          .getByLabel("Evidence type", { exact: true })
          .selectOption({ label: "Bookmarks" });
        expect(imageReads).toEqual([]);
        const photos = page.waitForResponse((response) => {
          const url = new URL(response.url());
          return (
            url.pathname === "/api/review" &&
            url.searchParams.get("include_images") === "true"
          );
        });
        await evidence
          .getByRole("button", { name: "Load evidence photos", exact: true })
          .click();
        const response = await photos;
        expect(response.ok()).toBe(true);
        expect((await response.json()).source_id).toBe(review.source_id);
        await expect(evidence.locator("img")).toHaveCount(1);
        await expect
          .poll(() =>
            evidence
              .locator("img")
              .evaluate(
                (image) =>
                  (image as HTMLImageElement).complete &&
                  (image as HTMLImageElement).naturalWidth > 0,
              ),
          )
          .toBe(true);
        await expect(
          evidence.getByText(bookmarkNote, { exact: true }),
        ).toBeVisible();
        await fitsViewport(page);
        expect(imageReads).toHaveLength(1);

        await nav
          .getByRole("button", { name: "Preparation", exact: true })
          .click();
        await expect(
          dialog.getByRole("region", {
            name: "Operator preparation",
            exact: true,
          }),
        ).toBeFocused();
        await nav.getByRole("button", { name: "Debrief", exact: true }).click();
        await expect(
          dialog.getByRole("region", { name: "Guardian debrief", exact: true }),
        ).toBeFocused();
        await expect(
          dialog.getByRole("button", { name: "Prepare debrief", exact: true }),
        ).toBeVisible();
        await expect(
          dialog.getByRole("button", {
            name: "Generate AI debrief",
            exact: true,
          }),
        ).toHaveCount(0);

        await nav.getByRole("button", { name: "Export", exact: true }).click();
        const download = page.waitForEvent("download");
        await dialog
          .getByRole("button", { name: "Offline HTML", exact: true })
          .click();
        const html = await fs.readFile(
          (await (await download).path())!,
          "utf8",
        );
        expect(html).toContain("Readiness.txt");
        expect(html).toContain(bookmarkNote);
        expect(html).toContain(openIssue);
        expect(html).toContain(resolutionNote);
        expect(html).toContain("Check the work area before beginning.");
        expect(html).not.toMatch(/<script|<iframe|src="https?:/i);
        await fitsViewport(page);
        expect((await api(page, "/api/session")).workflow).toEqual(
          workflowBefore,
        );
        expect(providerRequests).toEqual([]);
        expect(errors).toEqual([]);
      } catch (error) {
        await testInfo.attach("report-review-failure", {
          body: await page.screenshot(),
          contentType: "image/png",
        });
        throw error;
      } finally {
        await context.close();
        await browser.close();
      }
    });
  });
}

test("prepared PDF shows its prior snapshot until explicitly refreshed after a decision", async ({
  page,
}) => {
  await prepareReview(page);
  const before = await api(page, "/api/review?include_images=false");
  let dialog = await openReport(page);
  await dialog
    .getByRole("button", { name: "Prepare PDF", exact: true })
    .click();
  await expect(
    dialog.getByRole("button", { name: "Download PDF", exact: true }),
  ).toBeVisible();
  await expect(
    dialog.getByRole("status").filter({ hasText: "PDF ready" }),
  ).toContainText(`Review ${before.review_version}`);
  await dialog.getByRole("button", { name: "Close", exact: true }).click();
  const closeSources = page.getByRole("button", {
    name: "Close sources",
    exact: true,
  });
  if (await closeSources.isVisible()) await closeSources.click();
  await expect(
    page.getByRole("tab", { name: "Review", exact: true }),
  ).toBeVisible();
  await tool(page, "Review");
  await page.getByRole("button", { name: /^Exceptions/ }).click();
  const issue = page.getByRole("article").filter({ hasText: openIssue });
  await issue.getByRole("button", { name: "Acknowledge", exact: true }).click();
  await expect(issue).toContainText("acknowledged");
  const after = await api(page, "/api/review?include_images=false");
  expect(after.review_version).toBeGreaterThan(before.review_version);
  // Reopen the same Sources report instance that owns the prepared snapshot.
  // The workbench has its own independent report launcher.
  dialog = await openReport(page);
  await expect(
    dialog.getByText(/New activity has been recorded/),
  ).toBeVisible();
  await dialog
    .getByRole("button", { name: "Refresh PDF", exact: true })
    .click();
  await expect(dialog.getByText(/New activity has been recorded/)).toHaveCount(
    0,
  );
  await expect(
    dialog.getByRole("status").filter({ hasText: "PDF ready" }),
  ).toContainText(`Review ${after.review_version}`);
  const download = page.waitForEvent("download");
  await dialog
    .getByRole("button", { name: "Download PDF", exact: true })
    .click();
  expect(
    (await fs.readFile((await (await download).path())!))
      .subarray(0, 5)
      .toString(),
  ).toBe("%PDF-");
});
