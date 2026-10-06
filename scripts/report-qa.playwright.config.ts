import { defineConfig } from "../frontend/node_modules/@playwright/test/index.mjs";
import os from "node:os";
import path from "node:path";
const port = Number(process.env.REPORT_QA_PORT || 8113);

export default defineConfig({
  testDir: "../frontend/tests",
  timeout: 60000,
  expect: { timeout: 10000 },
  fullyParallel: false,
  retries: 0,
  workers: 1,
  outputDir: process.env.REPORT_QA_TEST_OUTPUT || path.join(os.tmpdir(), "cueveris-report-browser-results"),
  reporter: [["list"], ["json", { outputFile: process.env.REPORT_QA_RESULTS || path.join(os.tmpdir(), "cueveris-report-browser-results.json") }]],
  use: { baseURL: `http://127.0.0.1:${port}`, browserName: "chromium", channel: "chrome", viewport: { width: 1440, height: 1000 }, trace: "retain-on-failure", screenshot: "only-on-failure", reducedMotion: "reduce" },
  ...(process.env.REPORT_QA_EDITOR_MATRIX === "1" ? {
    projects: [
      { name: "Chrome", use: { browserName: "chromium" as const, channel: "chrome", launchOptions: { args: ["--use-fake-ui-for-media-stream"] } } },
      { name: "WebKit", use: { browserName: "webkit" as const, channel: "", launchOptions: {} } },
    ],
  } : {}),
  webServer: {
    command: "node --import tsx ../scripts/report-qa-fixture.mts",
    cwd: "../backend",
    url: `http://127.0.0.1:${port}/api/health`,
    reuseExistingServer: false,
    timeout: 30000,
  },
});
