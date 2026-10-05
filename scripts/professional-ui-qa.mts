import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
// Resolve the repository independently of the invoking shell's working directory.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const setupOnly = process.argv.includes("--check-setup");
const load = (file: string) =>
  import(pathToFileURL(path.join(root, file)).href);
const { createApp } = await load("backend/src/app.ts");
const { GuidanceEngine } = await load("backend/src/pipeline/guidance.ts");
const { fixtureComplete } = await load("backend/tests/fixtures.ts");
const { AccountStore } = await load("backend/src/account/store.ts");
const { chromium, webkit, expect } = await load(
  "frontend/node_modules/@playwright/test/index.mjs",
);
const accounts = new AccountStore({ file: ":memory:" });
let fixtureCalls = 0;
const app = await createApp({
  engine: new GuidanceEngine(async (input: unknown) => {
    fixtureCalls++;
    return fixtureComplete(input);
  }),
  accountStore: accounts,
});
const origin = "http://127.0.0.1:8104";
const screenshots = path.join(root, "docs/screenshots");
const output: unknown[] = [];
await fs.mkdir(screenshots, { recursive: true });
let browser: any;
const configurations = [
  {
    name: "desktop",
    browser: "chrome",
    width: 1440,
    height: 1000,
    dark: false,
  },
  { name: "phone", browser: "chrome", width: 390, height: 844, dark: false },
  {
    name: "small-phone",
    browser: "chrome",
    width: 320,
    height: 740,
    dark: false,
  },
  { name: "tablet", browser: "webkit", width: 820, height: 1180, dark: false },
  {
    name: "phone-dark",
    browser: "webkit",
    width: 390,
    height: 844,
    dark: true,
  },
];
const profile = process.argv.find(argument => argument.startsWith("--profile="))?.slice(10);
const selectedConfigurations = profile ? configurations.filter(configuration => configuration.name === profile) : configurations;
if (!selectedConfigurations.length) throw new Error(`Unknown visual QA profile: ${profile}`);
async function tool(page: any, name: string) {
  const tab = page.getByRole("tab", { name, exact: true });
  if (await tab.isVisible()) await tab.click();
  else {
    await page.getByRole("button", { name: "More guidance tools" }).click();
    await page.getByRole("menuitem", { name, exact: true }).click();
  }
}
async function capture(page: any, label: string) {
  // Wait for Radix's finite opening transition; do not photograph an intermediate frame.
  await page.waitForTimeout(350);
  await page.screenshot({
    path: path.join(screenshots, "professional-" + label + ".png"),
  });
  const result = await page.evaluate(() => {
    const dialog =
      document.querySelector(
        '.workspace-professional-dialog[data-state="open"][role="dialog"]',
      ) || document.querySelector('[role="dialog"]');
    const close = dialog?.querySelector(".dialog-close");
    const reportBody = dialog?.querySelector(".report-body");
    const d = dialog?.getBoundingClientRect(),
      c = close?.getBoundingClientRect();
    const viewport = { width: innerWidth, height: innerHeight };
    return {
      viewport,
      pageOverflow: document.documentElement.scrollWidth > innerWidth + 1,
      dialogOverflow: dialog
        ? dialog.scrollWidth > dialog.clientWidth + 1
        : false,
      reportBodyOverflow: reportBody
        ? reportBody.scrollWidth > reportBody.clientWidth + 1
        : false,
      reportBodyBounds: reportBody
        ? { client: reportBody.clientWidth, scroll: reportBody.scrollWidth }
        : null,
      overflowingContent: reportBody && reportBody.scrollWidth > reportBody.clientWidth + 1
        ? Array.from(reportBody.querySelectorAll("*")).filter(element => element.getBoundingClientRect().right > reportBody.getBoundingClientRect().right + 1).slice(0, 12).map(element => ({ tag: element.tagName, classes: element.className, width: element.getBoundingClientRect().width, text: element.textContent?.slice(0, 60) }))
        : [],
      dialogBox: d
        ? { x: d.x, y: d.y, width: d.width, height: d.height }
        : null,
      closeVisible:
        !!c &&
        c.top >= 0 &&
        c.bottom <= innerHeight &&
        c.left >= 0 &&
        c.right <= innerWidth,
      focusedLabel: document.activeElement?.getAttribute("aria-label"),
      clippedButtons: dialog
        ? Array.from(dialog.querySelectorAll("button"))
            .filter(
              (button) =>
                button.getBoundingClientRect().width > 0 &&
                button.scrollWidth > button.clientWidth + 1,
            )
            .map(
              (button) =>
                button.textContent?.trim() || button.getAttribute("aria-label"),
            )
        : [],
      text: dialog?.textContent?.slice(0, 180),
    };
  });
  expect(result.pageOverflow, `${label}: page overflow`).toBe(false);
  expect(result.dialogOverflow, `${label}: dialog overflow`).toBe(false);
  if (result.reportBodyOverflow) console.log(JSON.stringify({ label, ...result }));
  expect(result.reportBodyOverflow, `${label}: report body overflow`).toBe(false);
  expect(result.closeVisible, `${label}: close button in viewport`).toBe(true);
  expect(result.clippedButtons, `${label}: clipped controls`).toEqual([]);
  return result;
}
try {
  await fs.access(path.join(root, "frontend/dist/index.html"));
  await fs.access(path.join(root, "evaluation/assets/parts-sorting.mp4"));
  await app.listen({ host: "127.0.0.1", port: setupOnly ? 0 : 8104 });
  if (setupOnly) {
    const health = await app.inject({ method: "GET", url: "/api/health" });
    if (health.statusCode !== 200)
      throw new Error("Fixture backend did not start correctly.");
    for (const engine of ["chrome", "webkit"]) {
      browser =
        engine === "chrome"
          ? await chromium.launch({ channel: "chrome", headless: true })
          : await webkit.launch({ headless: true });
      await browser.close();
      browser = undefined;
    }
    console.log(
      "Professional UI QA setup OK: repository-relative imports, built frontend, video fixture, memory-only accounts, fixture backend, Chrome and WebKit.",
    );
  } else {
    for (const cfg of selectedConfigurations) {
      console.log("QA " + cfg.name + ": starting");
      browser =
        cfg.browser === "chrome"
          ? await chromium.launch({ channel: "chrome", headless: true })
          : await webkit.launch({ headless: true });
      const context = await browser.newContext({
        viewport: { width: cfg.width, height: cfg.height },
        colorScheme: cfg.dark ? "dark" : "light",
        isMobile: cfg.width < 500,
        hasTouch: cfg.browser === "webkit" || cfg.width < 500,
      });
      await context.addInitScript(
        (dark: boolean) =>
          localStorage.setItem("process-guide-theme", dark ? "dark" : "light"),
        cfg.dark,
      );
      const page = await context.newPage();
      page.setDefaultTimeout(12000);
      const errors: string[] = [],
        external: string[] = [];
      page.on("pageerror", (e: Error) => errors.push(e.message));
      page.on("request", (r: any) => {
        if (/^https?:/.test(r.url()) && !r.url().startsWith(origin))
          external.push(r.url());
      });
      await page.goto(origin);
      await page.getByTestId("intro-document-input").setInputFiles({
        name: "Readiness.txt",
        mimeType: "text/plain",
        buffer: Buffer.from(
          "Step 1: Prepare\nTools: Torque wrench, inspection lamp\nObjective: Prepare the station for the documented work.\nActions: Place the tool on the table.\nCriteria: Tool visibly on table.\nStep 2: Finish\nObjective: Store the tool and review the result.\nActions: Put the tool away.\nCriteria: Tool visibly stored.\nPrinciples: Check the work area before beginning.",
        ),
      });
      await expect(
        page.getByText("Readiness.txt · 2 steps extracted"),
      ).toBeVisible();
      await page
        .getByTestId("intro-video-input")
        .setInputFiles(path.join(root, "evaluation/assets/parts-sorting.mp4"));
      await page.getByRole("button", { name: "Open workspace" }).click();
      await expect
        .poll(() =>
          page
            .locator("video")
            .first()
            .evaluate((v: HTMLVideoElement) => v.readyState),
        )
        .toBeGreaterThanOrEqual(2);
      const sourcesOpen = page.getByRole("button", {
        name: "Pause guidance",
        exact: true,
      });
      if (!(await sourcesOpen.isVisible()))
        await page.getByRole("button", { name: "Sources and setup" }).click();
      if (await sourcesOpen.isVisible()) await sourcesOpen.click();
      const closeSources = page.getByRole("button", {
        name: "Close sources",
        exact: true,
      });
      if (await closeSources.isVisible()) await closeSources.click();
      await page
        .locator("video")
        .first()
        .evaluate((v: HTMLVideoElement) => v.pause());
      await tool(page, "Review");
      await page
        .getByLabel("Evidence bookmark note")
        .fill("Review the exact tool placement before the next action.");
      await page
        .getByRole("button", { name: "Save frame", exact: true })
        .click();
      await page.getByRole("button", { name: /^Exceptions/ }).click();
      await page
        .getByLabel("New exception title")
        .fill("Measurement evidence needs review");
      await page
        .getByRole("button", { name: "Raise exception", exact: true })
        .click();
      await expect(
        page
          .getByRole("article")
          .filter({ hasText: "Measurement evidence needs review" }),
      ).toBeVisible();
      await page
        .getByLabel("New exception title")
        .fill("Storage label confirmed with the operator");
      await page
        .getByRole("button", { name: "Raise exception", exact: true })
        .click();
      const resolvedIssue = page
        .getByRole("article")
        .filter({ hasText: "Storage label confirmed with the operator" });
      await resolvedIssue
        .getByLabel("Review note for Storage label confirmed with the operator")
        .fill(
          "Read the label and matched it to the work order before release.",
        );
      await resolvedIssue
        .getByRole("button", { name: "Resolve with note", exact: true })
        .click();
      await expect(resolvedIssue).toHaveCount(0);
      await tool(page, "Readiness");
      await page.getByLabel("Work order", { exact: true }).fill("WO-1024");
      await page.getByLabel("Asset / workstation").fill("Assembly station B");
      await page.getByLabel("Operator name").fill("Alex Müller");
      await page.getByRole("button", { name: "Save job context" }).click();
      await page.getByRole("checkbox").first().check();
      await tool(page, "Steps");
      const confirm = page.getByRole("button", {
        name: "Confirm Prepare manually",
        exact: true,
      });
      await expect(confirm).toBeVisible();
      await confirm.click();
      await expect(
        page.getByRole("button", {
          name: "Reset Prepare manually",
          exact: true,
        }),
      ).toBeVisible();
      const extractedToast = page
        .locator("[data-sonner-toast]")
        .filter({ hasText: /Extracted \d+ steps/ });
      // The temporary extraction toast can expire between locating its close
      // button and clicking it, especially in WebKit. Let its normal timer finish.
      await page.mouse.move(0, 0);
      await expect(extractedToast).toHaveCount(0, { timeout: 8000 });
      await page.getByRole("button", { name: "Account and training" }).click();
      const dialog = page.getByRole("dialog");
      await expect(dialog.getByLabel("Email", { exact: true })).toBeVisible();
      const checks: Record<string, unknown> = {};
      checks.signin = await capture(page, cfg.name + "-account-signin");
      await dialog
        .getByRole("button", { name: "Create account", exact: true })
        .click();
      checks.register = await capture(page, cfg.name + "-account-register");
      await dialog.getByLabel("Name", { exact: true }).fill("Alex Müller");
      await dialog
        .getByLabel("Email", { exact: true })
        .fill("visual-" + cfg.name + "@example.com");
      await dialog
        .getByLabel("Password", { exact: true })
        .fill("isolated-visual-passphrase-2026");
      await dialog
        .getByRole("button", { name: "Create my account", exact: true })
        .click();
      await expect(
        dialog.getByRole("button", {
          name: "Save current result",
          exact: true,
        }),
      ).toBeEnabled();
      checks.empty = await capture(page, cfg.name + "-account-empty");
      await dialog
        .getByRole("button", { name: "Save current result", exact: true })
        .click();
      await expect(dialog.getByRole("article")).toHaveCount(1);
      await dialog
        .getByRole("button", { name: "View result", exact: true })
        .click();
      await expect(
        dialog.getByRole("region", { name: /^Saved result details/ }),
      ).toBeFocused();
      checks.saved = await capture(page, cfg.name + "-account-saved");
      await dialog
        .getByText("Account data and deletion", { exact: true })
        .click();
      await dialog
        .getByLabel("Type DELETE to confirm", { exact: true })
        .scrollIntoViewIfNeeded();
      checks.deletion = await capture(page, cfg.name + "-account-deletion");
      await dialog.getByRole("button", { name: "Close", exact: true }).click();
      await expect(page.getByRole("dialog")).toHaveCount(0);
      // Clear the workbench's cached thumbnails before reviewing the report. The
      // report must fetch its photos only after the explicit user action below.
      await page.reload();
      await page
        .getByRole("button", { name: "Open workspace", exact: true })
        .click();
      await expect
        .poll(() =>
          page
            .locator("video")
            .first()
            .evaluate((v: HTMLVideoElement) => v.readyState),
        )
        .toBeGreaterThanOrEqual(2);
      if (!(await sourcesOpen.isVisible()))
        await page.getByRole("button", { name: "Sources and setup" }).click();
      if (await sourcesOpen.isVisible()) await sourcesOpen.click();
      if (await closeSources.isVisible()) await closeSources.click();
      await page
        .locator("video")
        .first()
        .evaluate((v: HTMLVideoElement) => v.pause());
      const reportReads: string[] = [],
        prohibitedCalls: string[] = [];
      page.on("request", (request: any) => {
        const url = new URL(request.url());
        if (
          url.pathname === "/api/review" &&
          url.searchParams.get("include_images") === "true"
        )
          reportReads.push(request.url());
        if (
          /^\/api\/(?:guidance\/analyze|analyze|ask|guardian|monitor|listen|tts|compare)(?:\/|$)/.test(
            url.pathname,
          )
        )
          prohibitedCalls.push(url.pathname);
      });
      const reportButton = page.getByRole("button", {
        name: "Report",
        exact: true,
      });
      if (!(await reportButton.isVisible()))
        await page.getByRole("button", { name: "Sources and setup" }).click();
      await reportButton.click();
      checks.report = await capture(page, cfg.name + "-report");
      const nav = dialog.getByRole("navigation", {
        name: "Report sections",
        exact: true,
      });
      const priorities = dialog.getByRole("region", {
        name: "Review priorities",
        exact: true,
      });
      await priorities
        .getByRole("button", {
          name: "Review criteria need review",
          exact: true,
        })
        .click();
      const workflowRegion = dialog.getByRole("region", {
        name: "Workflow evidence",
        exact: true,
      });
      await expect(workflowRegion).toBeFocused();
      checks.workflow = await capture(page, cfg.name + "-report-workflow");
      await priorities.scrollIntoViewIfNeeded();
      checks.priority = await capture(page, cfg.name + "-report-priority");
      await nav.getByRole("button", { name: "Evidence", exact: true }).click();
      const evidenceRegion = dialog.getByRole("region", {
        name: "Recorded evidence",
        exact: true,
      });
      await expect(evidenceRegion).toBeFocused();
      expect(reportReads).toHaveLength(0);
      await expect(evidenceRegion.locator("img")).toHaveCount(0);
      await evidenceRegion
        .getByLabel("Evidence type", { exact: true })
        .selectOption({ label: "Bookmarks" });
      await evidenceRegion
        .getByRole("button", { name: "Load evidence photos", exact: true })
        .click();
      await expect(evidenceRegion.locator("img")).toHaveCount(1);
      await expect
        .poll(() =>
          evidenceRegion
            .locator("img")
            .evaluate(
              (image: HTMLImageElement) =>
                image.complete && image.naturalWidth > 0,
            ),
        )
        .toBe(true);
      checks.evidence = await capture(page, cfg.name + "-report-evidence");
      await nav.getByRole("button", { name: "Issues", exact: true }).click();
      const issuesRegion = dialog.getByRole("region", {
        name: "Open review issues",
        exact: true,
      });
      await expect(issuesRegion).toBeFocused();
      await issuesRegion
        .getByLabel("Include resolved report issues", { exact: true })
        .check();
      await issuesRegion
        .getByText("Decision history (2)", { exact: true })
        .click();
      await expect(
        issuesRegion.getByText(
          "Read the label and matched it to the work order before release.",
          { exact: true },
        ),
      ).toBeVisible();
      checks.history = await capture(page, cfg.name + "-report-history");
      await nav
        .getByRole("button", { name: "Preparation", exact: true })
        .click();
      await expect(
        dialog.getByRole("region", {
          name: "Operator preparation",
          exact: true,
        }),
      ).toBeFocused();
      checks.preparation = await capture(
        page,
        cfg.name + "-report-preparation",
      );
      await nav.getByRole("button", { name: "Export", exact: true }).click();
      await page
        .getByRole("button", { name: "Prepare PDF", exact: true })
        .click();
      await expect(
        page.getByRole("button", { name: "Download PDF", exact: true }),
      ).toBeVisible({ timeout: 20000 });
      checks.ready = await capture(page, cfg.name + "-report-ready");
      await nav.getByRole("button", { name: "Debrief", exact: true }).click();
      const generate = page.getByRole("button", {
        name: "Prepare debrief",
        exact: true,
      });
      await generate.scrollIntoViewIfNeeded();
      await generate.click();
      await expect(
        page.getByRole("button", { name: "Refresh debrief", exact: true }),
      ).toBeVisible();
      checks.debrief = await capture(page, cfg.name + "-report-debrief");
      expect(reportReads).toHaveLength(1);
      expect(prohibitedCalls).toEqual([]);
      expect(errors).toEqual([]);
      expect(external).toEqual([]);
      output.push({
        profile: cfg.name,
        checks,
        errors,
        external,
        report_photo_reads: reportReads.length,
        report_provider_requests: prohibitedCalls,
      });
      await context.close();
      await browser.close();
      browser = undefined;
      console.log("QA " + cfg.name + ": complete");
    }
    console.log(
      JSON.stringify(
        {
          profiles: output.map((entry: any) => ({
            profile: entry.profile,
            states: Object.keys(entry.checks).length,
            errors: entry.errors,
            external: entry.external,
            clippedButtons: Object.values(entry.checks).flatMap(
              (state: any) => state.clippedButtons || [],
            ),
          })),
          fixture_calls: fixtureCalls,
          actual_provider_calls: 0,
          accounts_in_memory: true,
        },
        null,
        2,
      ),
    );
    const verificationPath = profile ? path.join(root, `tmp/pdfs/report-editorial/ui-${profile}.json`) : path.join(root, "docs/professional-ui-validation.json");
    await fs.mkdir(path.dirname(verificationPath), { recursive: true });
    await fs.writeFile(
      verificationPath,
      JSON.stringify(
        {
          validated_at: new Date().toISOString(),
          results: output,
          fixture_calls: fixtureCalls,
          actual_provider_calls: 0,
          accounts_in_memory: true,
        },
        null,
        2,
      ) + "\n",
    );
  }
} finally {
  if (browser) await browser.close();
  await app.close();
  accounts.close();
}
