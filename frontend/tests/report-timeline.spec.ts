import { chromium, expect, test, webkit } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";
import { api, setup, tool } from "./review-helpers";

const profiles = [
  { name: "desktop", width: 1440, height: 1000, webkit: false, touch: false },
  { name: "phone", width: 320, height: 740, webkit: false, touch: true },
  { name: "tablet", width: 820, height: 1180, webkit: true, touch: true },
  { name: "phone-dark", width: 390, height: 844, webkit: true, touch: true, dark: true },
];

for (const profile of profiles) {
  test(`report timeline on ${profile.name} selects retained frames and replays without changing confirmations`, async ({ baseURL }, testInfo) => {
    const browser = profile.webkit
      ? await webkit.launch({ channel: "", args: [], headless: true })
      : await chromium.launch({ channel: "chrome", headless: true });
    const context = await browser.newContext({
      baseURL, viewport: { width: profile.width, height: profile.height },
      isMobile: profile.touch, hasTouch: profile.touch, reducedMotion: "reduce",
      colorScheme: "dark" in profile && profile.dark ? "dark" : "light",
    });
    await context.addInitScript((dark: boolean) => localStorage.setItem("process-guide-theme", dark ? "dark" : "light"), "dark" in profile && !!profile.dark);
    const page = await context.newPage();
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    try {
      await setup(page);
      await tool(page, "Review");
      const video = page.locator("video").first();
      for (const time of [0, 6]) {
        const seek = time === 0 ? null : page.waitForResponse(r => r.url().includes("/api/workflow/seek") && r.ok());
        await video.evaluate((element, time) => {
          const media = element as HTMLVideoElement;
          media.currentTime = time;
          media.pause();
        }, time);
        if (seek) await seek;
        await expect.poll(() => video.evaluate((element, time) => {
          const media = element as HTMLVideoElement;
          return !media.seeking && media.readyState >= 2 && Math.abs(media.currentTime - time) < 0.1;
        }, time)).toBe(true);
        await page.getByLabel("Evidence bookmark note").fill(`Timeline inspection at ${time} seconds`);
        await page.getByRole("button", { name: "Save frame", exact: true }).click();
        await expect(page.getByRole("article").filter({ hasText: `Timeline inspection at ${time} seconds` })).toBeVisible();
      }
      const rewind = page.waitForResponse(r => r.url().includes("/api/workflow/seek") && r.ok());
      await video.evaluate(element => { (element as HTMLVideoElement).currentTime = 1; });
      await rewind;
      await tool(page, "Steps");
      await page.getByRole("button", { name: "Confirm Prepare manually", exact: true }).click();
      await expect(page.getByRole("button", { name: "Reset Prepare manually", exact: true })).toBeVisible();
      const before = (await api(page, "/api/session")).workflow;
      const requests: string[] = [];
      page.on("request", request => {
        const route = new URL(request.url()).pathname;
        if (/^\/api\/(?:guidance\/analyze|llm|tts|review\/incidents)(?:\/|$)/.test(route)) requests.push(route);
      });
      const report = page.getByRole("button", { name: "Report", exact: true });
      if (!(await report.isVisible())) await page.getByRole("button", { name: "Sources and setup" }).click();
      await report.click();
      const dialog = page.getByRole("dialog").filter({
        has: page.getByRole("heading", { name: "Session report", exact: true }),
      });
      const nav = dialog.getByRole("navigation", { name: "Report sections" });
      await expect(dialog.getByRole("heading", { name: "Session report", exact: true })).toBeVisible();
      const destination = path.resolve("../tmp/pdfs/report-editorial");
      await fs.mkdir(destination, { recursive: true });
      await page.screenshot({ path: path.join(destination, `workspace-${profile.name}-overview.png`) });
      await nav.getByRole("button", { name: "Timeline", exact: true }).click();
      const timeline = dialog.getByRole("region", { name: "Recorded timeline", exact: true });
      await expect(timeline).toBeFocused();
      const select = timeline.getByLabel("Choose recorded moment");
      const target = await select.locator("option").filter({ hasText: "Timeline inspection at 6 seconds" }).getAttribute("value");
      await select.selectOption(target!);
      await expect(timeline.locator(".report-selected-moment")).toContainText("Timeline inspection at 6 seconds");
      await expect(timeline.locator(".report-selected-moment")).toContainText("Operator record");
      await expect(dialog.getByRole("button", { name: "Close", exact: true })).toBeInViewport();
      await expect(nav).toBeInViewport();
      const metrics = await dialog.evaluate(element => ({
        pageOverflow: document.documentElement.scrollWidth > innerWidth + 1,
        reportOverflow: element.scrollWidth > element.clientWidth + 1,
        bodyOverflow: (() => { const body = element.querySelector(".report-body")!; return body.scrollWidth > body.clientWidth + 1; })(),
        bodyBounds: (() => { const body = element.querySelector(".report-body")!; return { client: body.clientWidth, scroll: body.scrollWidth, left: body.scrollLeft }; })(),
        wideContent: [...element.querySelectorAll(".report-body *")].filter(child => child.scrollWidth > child.clientWidth + 20).slice(0, 20).map(child => ({ tag: child.tagName, classes: child.className, client: child.clientWidth, scroll: child.scrollWidth, text: child.textContent?.slice(0, 60) })),
        outerScroll: element.scrollTop,
        controlSizes: [...element.querySelectorAll(".report-moment-controls button, .report-moment-controls select")]
          .map(control => control.getBoundingClientRect().height),
      }));
      expect(metrics.pageOverflow).toBe(false);
      expect(metrics.reportOverflow).toBe(false);
      if (metrics.bodyOverflow) console.log(JSON.stringify(metrics));
      expect(metrics.bodyOverflow).toBe(false);
      expect(metrics.outerScroll).toBe(0);
      expect(metrics.controlSizes.every(height => height >= 44)).toBe(true);
      await page.screenshot({ path: path.join(destination, `workspace-${profile.name}-timeline.png`) });
      await testInfo.attach("layout-checks", { body: JSON.stringify(metrics), contentType: "application/json" });
      const replay = page.waitForResponse(r => r.url().includes("/api/workflow/seek") && r.ok());
      await timeline.getByRole("button", { name: "Review in video", exact: true }).click();
      await replay;
      await expect(dialog).toHaveCount(0);
      await expect.poll(() => video.evaluate(element => (element as HTMLVideoElement).currentTime)).toBeCloseTo(6, 0);
      expect(await video.evaluate(element => (element as HTMLVideoElement).paused)).toBe(true);
      expect((await api(page, "/api/session")).workflow).toEqual(before);
      expect(requests).toEqual([]);
      expect(errors).toEqual([]);
    } finally {
      await context.close();
      await browser.close();
    }
  });
}
