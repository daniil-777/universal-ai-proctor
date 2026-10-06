import { defineConfig } from "../frontend/node_modules/@playwright/test/index.mjs";
import os from "node:os";
import path from "node:path";
const port = Number(process.env.VIDEO_SUMMARY_QA_PORT || 8115);
export default defineConfig({
  testDir: "../frontend/tests", testMatch: "video-summary.spec.ts", timeout: 90000,
  expect: { timeout: 20000 }, fullyParallel: false, retries: 0, workers: 1,
  outputDir: process.env.VIDEO_SUMMARY_QA_OUTPUT || path.join(os.tmpdir(), "cueveris-video-summary-browser"),
  reporter: [["list"], ["json", { outputFile: process.env.VIDEO_SUMMARY_QA_RESULTS || path.join(os.tmpdir(), "cueveris-video-summary-browser-results.json") }]],
  use: { baseURL: `http://127.0.0.1:${port}`, browserName: "chromium", channel: "chrome", viewport: { width: 1440, height: 1000 }, reducedMotion: "reduce", trace: "retain-on-failure", screenshot: "only-on-failure" },
  webServer: { command: "node --import tsx ../scripts/video-summary-qa-fixture.mts", cwd: "../backend", url: `http://127.0.0.1:${port}/api/health`, reuseExistingServer: false, timeout: 30000 },
});
