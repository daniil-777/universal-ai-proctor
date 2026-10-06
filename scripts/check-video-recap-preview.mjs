import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { chromium, webkit } from "../frontend/node_modules/@playwright/test/index.mjs";

const base = new URL(process.argv[2] || "http://127.0.0.1:8117");
if (base.hostname !== "127.0.0.1") throw new Error("This bounded preview check runs on an isolated loopback static server.");
const output = path.join(os.tmpdir(), "cueveris-static-recap-qa");
await fs.mkdir(output, { recursive: true });
const results = [];
function contrast(foreground, background) {
  const luminance = rgb => rgb.map(channel => channel / 255).map(channel => channel <= .04045 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4).reduce((sum, channel, index) => sum + channel * [.2126, .7152, .0722][index], 0);
  const first = luminance(foreground), second = luminance(background);
  return (Math.max(first, second) + .05) / (Math.min(first, second) + .05);
}
for (const scenario of [
  { name: "chrome-desktop", engine: chromium, viewport: { width: 1440, height: 1000 }, colorScheme: "light", textSize: 16 },
  { name: "chrome-phone-large-text", engine: chromium, viewport: { width: 320, height: 850 }, colorScheme: "light", textSize: 32 },
  { name: "webkit-tablet", engine: webkit, viewport: { width: 820, height: 1000 }, colorScheme: "light", textSize: 16 },
  { name: "webkit-dark-phone-large-text", engine: webkit, viewport: { width: 390, height: 850 }, colorScheme: "dark", textSize: 32 },
]) {
  const browser = await scenario.engine.launch(scenario.engine === chromium ? { channel: "chrome" } : {});
  try {
    const page = await browser.newPage({ viewport: scenario.viewport, colorScheme: scenario.colorScheme, reducedMotion: "reduce", acceptDownloads: true });
    const errors = [], requests = [];
    page.on("pageerror", error => errors.push(error.message));
    page.on("request", request => requests.push(request.url()));
    await page.goto(new URL("/media/cueveris-video-recap-preview.html", base).href, { waitUntil: "load" });
    await page.evaluate(size => { document.documentElement.style.fontSize = `${size}px`; }, scenario.textSize);
    assert.match(await page.locator(".disclosure").innerText(), /Illustrative example.*simulated data.*no video analyzed/);
    assert.equal(await page.locator("script, video, iframe").count(), 0);
    const bounds = await page.evaluate(() => ({ width: innerWidth, document: document.documentElement.scrollWidth, offenders: [...document.querySelectorAll("main, .body, .metrics, .metric, .evidence, .sample, .citations")].filter(element => element.scrollWidth > element.clientWidth + 1).map(element => ({ selector: element.className, client: element.clientWidth, scroll: element.scrollWidth })) }));
    assert.ok(bounds.document <= bounds.width + 1, `${scenario.name} document overflows: ${JSON.stringify(bounds)}`);
    assert.deepEqual(bounds.offenders, [], `${scenario.name} reading bounds`);
    const colors = await page.evaluate(() => {
      const rgb = color => color.match(/[\d.]+/g).slice(0, 3).map(Number);
      const background = element => { for (let current = element; current; current = current.parentElement) { const color = getComputedStyle(current).backgroundColor; if (!color.endsWith(", 0)") && color !== "transparent") return rgb(color); } return [255, 255, 255]; };
      return [".disclosure", ".lead", ".identity", ".brand", ".status", ".metric p:not(.value)", ".value", ".action.primary", ".timeline a"].flatMap(selector => [...document.querySelectorAll(selector)].map(element => ({ selector, foreground: rgb(getComputedStyle(element).color), background: background(element), opacity: Number(getComputedStyle(element).opacity) })));
    });
    const ratios = colors.map(color => { assert.equal(color.opacity, 1); return { selector: color.selector, ratio: contrast(color.foreground, color.background) }; });
    ratios.forEach(color => assert.ok(color.ratio >= 4.5, `${scenario.name} ${color.selector} contrast ${color.ratio.toFixed(2)} is below 4.5:1`));
    await page.screenshot({ path: path.join(output, `${scenario.name}-hero.png`) });
    const download = page.waitForEvent("download");
    await page.getByRole("link", { name: "Download simulated JSON", exact: false }).first().click();
    const file = await (await download).path();
    const fixture = JSON.parse(await fs.readFile(file, "utf8"));
    assert.equal(fixture.job.provenance.simulated, true); assert.equal(fixture.job.provenance.model_calls, 0);
    assert.deepEqual(fixture.job.metrics.map(metric => [metric.status, metric.value]), [["estimated", 2], ["estimated", 1], ["unavailable", null], ["unavailable", null]]);
    await page.locator(".metric").first().locator("summary").click();
    const citation = page.locator(".metric").first().getByRole("link", { name: "Read illustrative evidence W0001-E01", exact: true });
    await citation.focus(); await page.keyboard.press("Enter");
    assert.equal(new URL(page.url()).hash, "#evidence-W0001-E01");
    const evidence = page.locator("#evidence-W0001-E01");
    assert.ok(await evidence.isVisible());
    await evidence.getByRole("link", { name: "Read synthetic sample W0001-F01", exact: true }).click();
    assert.equal(new URL(page.url()).hash, "#evidence-W0001-F01");
    const sample = page.locator("#evidence-W0001-F01");
    assert.match(await sample.innerText(), /No image exists/);
    const target = await sample.boundingBox(), label = await page.locator(".disclosure").boundingBox();
    assert.ok(target.y >= label.y + label.height - 1 && target.y < scenario.viewport.height, `${scenario.name} evidence target is readable below persistent label`);
    assert.ok((await page.locator(".disclosure").boundingBox()).y >= 0);
    await page.screenshot({ path: path.join(output, `${scenario.name}-evidence.png`) });
    await page.screenshot({ path: path.join(output, `${scenario.name}.png`), fullPage: true });
    assert.deepEqual(errors, []);
    assert.ok(requests.every(url => new URL(url).origin === base.origin && !new URL(url).pathname.startsWith("/api/")), "No external or API requests");
    await page.getByRole("link", { name: "See the workflow report example" }).click();
    await page.getByRole("link", { name: "See the simulated video recap" }).click();
    assert.equal(new URL(page.url()).pathname, "/media/cueveris-video-recap-preview.html");
    results.push({ scenario: scenario.name, passed: true, viewport: scenario.viewport, textSize: scenario.textSize, simulated: true, apiRequests: 0, pageErrors: 0, minimumCheckedTextContrast: Math.min(...ratios.map(color => color.ratio)) });
  } finally { await browser.close(); }
}
await fs.writeFile(path.join(output, "results.json"), `${JSON.stringify(results, null, 2)}\n`);
console.log(JSON.stringify({ passed: results.length, artifacts: output, noVideoAnalyzed: true, providerCalls: 0 }));
