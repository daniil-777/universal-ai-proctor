// Real browser checks for offline report files. No servers, accounts or model calls.
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const { chromium, webkit } = await import(pathToFileURL(path.join(root, "frontend/node_modules/@playwright/test/index.mjs")).href);
const destination = path.join(root, "tmp/pdfs/report-upgrade");
await fs.mkdir(destination, { recursive: true });
const profiles = [
  { name: "desktop", width: 1440, height: 1000, engine: "chrome" },
  { name: "phone", width: 390, height: 844, engine: "webkit" },
  { name: "tablet", width: 820, height: 1180, engine: "webkit" },
  { name: "empty-camera", width: 390, height: 844, engine: "webkit", fixture: "empty-camera" },
  { name: "long-title", width: 390, height: 844, engine: "chrome", fixture: "long-title" },
];
const checks = [];
for (const profile of profiles) {
  const browser = profile.engine === "chrome" ? await chromium.launch({ channel: "chrome", headless: true }) : await webkit.launch({ headless: true });
  try {
    const context = await browser.newContext({ viewport: { width: profile.width, height: profile.height }, isMobile: profile.width < 500, hasTouch: profile.engine === "webkit" });
    const page = await context.newPage(), errors = [], requests = [];
    page.on("pageerror", error => errors.push(error.message));
    page.on("request", request => { if (/^https?:/.test(request.url())) requests.push(request.url()); });
    const source = profile.fixture ? path.join(destination, profile.fixture + ".html") : path.join(root, "output/pdf/process-guide-analysis-sample.html");
    await page.goto(pathToFileURL(source).href);
    const metrics = await page.evaluate(() => ({
      overflow: document.documentElement.scrollWidth > innerWidth + 1,
      images: [...document.images].map(image => ({ complete: image.complete, width: image.naturalWidth })),
      headingCount: document.querySelectorAll("h2").length,
      linksResolve: [...document.querySelectorAll('a[href^="#"]')].every(anchor => document.querySelector(anchor.getAttribute("href"))),
      scripts: document.scripts.length,
      timelineBins: [...document.querySelectorAll(".moment-lane>span")].map(bin => ({
        height: bin.getBoundingClientRect().height,
        padding: parseFloat(getComputedStyle(bin).paddingTop),
      })),
    }));
    if (metrics.overflow || metrics.images.some(image => !image.complete || image.width === 0) || !metrics.linksResolve || metrics.scripts || errors.length || requests.length || metrics.timelineBins.some(bin => bin.height > 34 || bin.padding !== 0)) throw new Error(JSON.stringify({ profile, metrics, errors, requests }));
    await page.screenshot({ path: path.join(destination, "html-" + profile.name + "-top.png") });
    await page.screenshot({ path: path.join(destination, "html-" + profile.name + ".png"), fullPage: true });
    if (!profile.fixture) {
      for (const section of ["timeline", "workflow", "exceptions", "evidence", "readiness", "reference"]) {
        await page.locator("#" + section).scrollIntoViewIfNeeded();
        await page.screenshot({ path: path.join(destination, "html-" + profile.name + "-" + section + ".png") });
      }
      if (profile.engine === "chrome") await page.pdf({ path: path.join(destination, "html-print.pdf"), printBackground: true, preferCSSPageSize: true });
    }
    checks.push({ profile: profile.name, ...metrics, pageErrors: errors, externalRequests: requests });
  } finally { await browser.close(); }
}
await fs.writeFile(path.join(destination, "html-validation.json"), JSON.stringify({ checked_at: new Date().toISOString(), checks }, null, 2));
console.log(JSON.stringify(checks));
