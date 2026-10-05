import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const { chromium, webkit, expect } = await import(
  pathToFileURL(
    path.join(root, "frontend/node_modules/@playwright/test/index.mjs"),
  ).href
);
const origin = "http://localhost:8101";
const evidence: any = {
  checked_at: new Date().toISOString(),
  app_url: origin,
  profiles: [],
  completed: false,
  scope:
    "Compiled running-app sample menu, preserved instructions, real media decoding and responsive layout. Automatic visual requests explicitly forced to demo; no paid AI or external messages. Separate live validation measures sampled provider answers.",
};
try {
  for (const profile of [
    { name: "desktop", width: 1440, height: 1000, engine: "chrome" },
    { name: "phone", width: 390, height: 844, engine: "chrome" },
    { name: "tablet", width: 820, height: 1180, engine: "webkit" },
  ]) {
    const browser = await (profile.engine === "chrome"
      ? chromium.launch({ channel: "chrome" })
      : webkit.launch());
    const context = await browser.newContext({
      viewport: { width: profile.width, height: profile.height },
      isMobile: profile.name !== "desktop",
      hasTouch: profile.name !== "desktop",
    });
    const page = await context.newPage();
    const errors: string[] = [],
      external: string[] = [];
    let demoRequests = 0;
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("request", (request) => {
      if (new URL(request.url()).origin !== origin)
        external.push(request.url());
    });
    await page.route("**/api/guidance/analyze", async (route) => {
      demoRequests++;
      await route.continue({
        postData: JSON.stringify({
          ...route.request().postDataJSON(),
          demo: true,
        }),
      });
    });
    try {
      await page.goto(origin);
      await page
        .getByRole("combobox", { name: "Choose a sample video", exact: true })
        .click();
      await page
        .getByRole("option", { name: /Uncomplicated cholecystectomy/ })
        .click();
      await expect(
        page.getByText(/Cholecystectomy\.txt · 6 steps extracted/),
      ).toBeVisible();
      await page
        .getByRole("button", { name: "Open workspace", exact: true })
        .click();
      const video = page.locator("video").first();
      await expect
        .poll(() => video.evaluate((v: HTMLVideoElement) => v.readyState))
        .toBeGreaterThanOrEqual(2);
      await video.evaluate((v: HTMLVideoElement) => {
        v.pause();
        v.currentTime = 216;
      });
      await expect
        .poll(() =>
          video.evaluate(
            (v: HTMLVideoElement) => !v.seeking && v.readyState >= 2,
          ),
        )
        .toBe(true);
      const result = await page.evaluate(async () => {
        const headers = {
          "X-Guidance-Session": sessionStorage.getItem(
            "process-guide-session",
          )!,
        };
        const session = await (await fetch("/api/session", { headers })).json();
        const reference = await (
          await fetch("/api/reference/document", { headers })
        ).json();
        const video = document.querySelector("video")!;
        return {
          source: session.source_name,
          filename: session.filename,
          steps: session.workflow.steps.length,
          incomplete: session.workflow.steps.every(
            (step: any) => !step.complete,
          ),
          text: reference.text,
          duration_s: video.duration,
          video_width: video.videoWidth,
          current_s: video.currentTime,
          overflow: document.documentElement.scrollWidth > innerWidth + 1,
        };
      });
      expect(result.text).toBe(
        await fs.readFile(
          path.join(root, "guidance-library/Cholecystectomy.txt"),
          "utf8",
        ),
      );
      expect(result.steps).toBe(6);
      expect(result.incomplete).toBe(true);
      expect(result.video_width).toBe(660);
      expect(Math.abs(result.duration_s - 252.766667)).toBeLessThan(0.05);
      expect(result.overflow).toBe(false);
      expect(errors).toEqual([]);
      expect(external).toEqual([]);
      await page.screenshot({
        path: path.join(
          root,
          `docs/screenshots/surgery-production-${profile.name}.png`,
        ),
      });
      delete result.text;
      evidence.profiles.push({
        ...profile,
        ...result,
        errors,
        external_requests: external,
        automatic_demo_requests: demoRequests,
      });
    } finally {
      // Remove only this smoke's anonymous staged video; the immutable default
      // and all other users' sources/accounts remain untouched.
      await page
        .evaluate(async () => {
          const session = sessionStorage.getItem("process-guide-session");
          if (session)
            await fetch("/api/source", {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "X-Guidance-Session": session,
              },
              body: JSON.stringify({
                source_id: crypto.randomUUID(),
                kind: "video",
                name: "Completed production smoke",
              }),
            });
        })
        .catch(() => {});
      await context.close();
      await browser.close();
    }
  }
  evidence.completed = true;
} finally {
  await fs.writeFile(
    path.join(root, "docs/surgery-production-smoke.json"),
    JSON.stringify(evidence, null, 2) + "\n",
  );
}
console.log(JSON.stringify(evidence));
