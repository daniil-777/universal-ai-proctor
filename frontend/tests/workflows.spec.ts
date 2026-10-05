import { test, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFileSync } from "node:child_process";
import type { Page } from "@playwright/test";
const directory = fs.mkdtempSync(
  path.join(os.tmpdir(), "process-guide-browser-"),
);
const video = path.join(directory, "process.mp4");
const document = Buffer.from(
  "Safety\nAlways check the work area.\nStep 1 — Prepare\nActions: Place the tool on the table.\nCriteria: Tool visibly on table.\nStep 2 — Finish\nActions: Put the tool away.\nCriteria: Tool visibly stored.",
);
test.beforeAll(() =>
  execFileSync("ffmpeg", [
    "-loglevel",
    "error",
    "-f",
    "lavfi",
    "-i",
    "testsrc2=s=640x360:r=12",
    "-t",
    "15",
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    "-y",
    video,
  ]),
);
test.afterAll(() => fs.rmSync(directory, { recursive: true, force: true }));
async function workspace(page: Page, withDocument = true, withVideo = true) {
  await page.goto("/");
  if (withDocument) {
    await page.getByTestId("intro-document-input").setInputFiles({
      name: "Assembly.txt",
      mimeType: "text/plain",
      buffer: document,
    });
    await expect(
      page.getByText("Assembly.txt · 2 steps extracted"),
    ).toBeVisible();
  }
  if (withVideo)
    await page.getByTestId("intro-video-input").setInputFiles(video);
  await page.getByRole("button", { name: "Open workspace" }).click();
}

test("document + video: evidence, chat, principles, resizing and exports", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await workspace(page);
  await expect(page.getByTestId("step-S1")).toBeVisible();
  await expect(
    page.getByText("Place the tool on the table.", { exact: true }).first(),
  ).toBeVisible();
  await expect(
    page.getByText("Check the work area before the next documented action.", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page
      .getByText("Test fixture: tool visible on table.", { exact: false })
      .first(),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Analyze current view", exact: true })
    .click();
  await page.getByRole("tab", { name: "Principles", exact: true }).click();
  await expect(
    page.getByText("Always check the work area.", { exact: true }),
  ).toBeVisible();
  await page.getByRole("tab", { name: "Steps", exact: true }).click();
  await page.getByRole("button", { name: /^Pause guidance$/ }).click();
  const step = page.getByTestId("step-S2");
  await step.getByRole("button", { name: /Finish/ }).click();
  await step.getByRole("button", { name: "Confirm Finish manually" }).click();
  await expect(step.getByText("Operator confirmed")).toBeVisible();
  await page.getByRole("button", { name: "Open chat" }).click();
  await page.getByPlaceholder(/Ask/).fill("What is visible?");
  await page.getByRole("button", { name: "Send message" }).click();
  await expect(
    page
      .getByText("The visible tool is on the table.", { exact: false })
      .first(),
  ).toBeVisible();
  await page.getByRole("button", { name: "Close chat" }).click();
  const handle = page.getByRole("button", { name: /Resize Guardian/ }).first();
  await expect(handle).toBeVisible();
  await handle.focus();
  await page.keyboard.press("ArrowRight");
  await page.getByRole("button", { name: "Report", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Session report", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Workflow evidence", { exact: true }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Engineer", exact: true }).click();
  await page.getByRole("tab", { name: "Compare", exact: true }).click();
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download session ZIP" }).click();
  expect((await download).suggestedFilename()).toContain(".zip");
  await page.getByRole("button", { name: "Guide", exact: true }).click();
  await page.getByRole("tab", { name: "Steps", exact: true }).click();
  await page.screenshot({
    path: "test-results/workspace-1600.png",
    fullPage: true,
  });
  expect(errors).toEqual([]);
});
test("video only builds an editable provisional workflow", async ({ page }) => {
  await workspace(page, false);
  await expect(page.getByText("Provisional", { exact: true })).toBeVisible();
  await expect(page.getByTestId("step-S3")).toBeVisible();
  await expect(
    page.getByText("Prepare the workspace", { exact: true }),
  ).toBeVisible();
});
test("camera only starts live guidance and releases the camera", async ({
  page,
  context,
}) => {
  await context.grantPermissions(["camera", "microphone"]);
  await page.goto("/");
  await page
    .getByRole("button", { name: "Use your camera", exact: false })
    .click();
  await expect(page.getByText("Camera", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Open workspace" }).click();
  await expect(page.getByText("Provisional", { exact: true })).toBeVisible();
  await expect(page.locator("video")).toHaveJSProperty("readyState", 4);
  await page.getByRole("button", { name: "Stop live input" }).click();
  await expect(
    page.getByRole("button", { name: "Stop live input" }),
  ).toHaveCount(0);
});
test("camera acquisition errors remain actionable and retry preserves instructions", async ({
  page,
  context,
}) => {
  await context.grantPermissions(["camera", "microphone"]);
  await page.addInitScript(() => {
    const original = navigator.mediaDevices.getUserMedia.bind(
      navigator.mediaDevices,
    );
    let first = true;
    navigator.mediaDevices.getUserMedia = async (constraints) => {
      if (first) {
        first = false;
        throw new DOMException("Synthetic device failure", "NotReadableError");
      }
      return original(constraints);
    };
  });
  await page.goto("/");
  await page
    .getByTestId("intro-document-input")
    .setInputFiles({
      name: "Camera retry.txt",
      mimeType: "text/plain",
      buffer: document,
    });
  await expect(
    page.getByText("Camera retry.txt · 2 steps extracted"),
  ).toBeVisible();
  const camera = page.getByRole("button", {
    name: "Use your camera",
    exact: false,
  });
  await camera.click();
  await expect(
    page.getByText("Camera could not start", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText(/capture device is busy or unavailable/),
  ).toBeVisible();
  await expect(page.getByText("Camera", { exact: true })).toHaveCount(0);
  await camera.click();
  await expect(page.getByText("Camera", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Open workspace" }).click();
  await expect(page.getByTestId("step-S1")).toBeVisible();
  await expect(page.locator("video")).toHaveJSProperty("readyState", 4);
  await page.getByRole("button", { name: "Stop live input" }).click();
});
test("camera with a document keeps authoritative actions on the right", async ({
  page,
  context,
}) => {
  await context.grantPermissions(["camera", "microphone"]);
  await workspace(page, true, false);
  await page.getByRole("button", { name: "Camera", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Stop live input" }),
  ).toBeVisible();
  await expect(page.getByTestId("step-S2")).toBeVisible();
  await expect(page.getByText("Document", { exact: true })).toBeVisible();
  await expect(
    page.getByText("Check the work area before the next documented action.", {
      exact: true,
    }),
  ).toBeVisible();
});
test("screen workflow and session recording download", async ({
  page,
  context,
}) => {
  await context.grantPermissions(["camera", "microphone"]);
  // Browser permission UI is outside this test; a fake camera stream verifies the screen path.
  await page.addInitScript(() => {
    navigator.mediaDevices.getDisplayMedia = async () =>
      navigator.mediaDevices.getUserMedia({ video: true });
  });
  await workspace(page, false, false);
  await page.getByRole("button", { name: "Screen", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Stop live input" }),
  ).toBeVisible();
  await expect(page.getByText("Provisional", { exact: true })).toBeVisible();
  await page
    .getByRole("button", { name: "Record session", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Stop recording", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Stop recording", exact: true }),
  ).toHaveText(/1s/);
  const download = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Stop recording", exact: true })
    .click();
  const recording = await download;
  expect(recording.suggestedFilename()).toMatch(/process-recording.*webm/);
  const saved = await recording.path();
  expect(fs.statSync(saved!).size).toBeGreaterThan(500);
  const info = JSON.parse(
    execFileSync(
      "ffprobe",
      [
        "-v",
        "error",
        "-show_entries",
        "stream=codec_type",
        "-of",
        "json",
        saved!,
      ],
      { encoding: "utf8" },
    ),
  );
  expect(
    info.streams.some((s: { codec_type: string }) => s.codec_type === "video"),
  ).toBe(true);
});
test("analysis-region changes and Guardian mouse resizing are persistent", async ({
  page,
}) => {
  await workspace(page);
  await expect(
    page.getByText("Test fixture: review the visible work area.", {
      exact: true,
    }),
  ).toBeVisible();
  const box = page.locator('[data-guardian-message="Guardian safety message"]');
  const before = await box.boundingBox();
  const handle = page.getByRole("button", {
    name: "Resize Guardian safety message",
    exact: true,
  });
  const grip = await handle.boundingBox();
  await page.mouse.move(grip!.x + grip!.width / 2, grip!.y + grip!.height / 2);
  await page.mouse.down();
  await page.mouse.move(
    grip!.x + grip!.width / 2 + 60,
    grip!.y + grip!.height / 2 + 5,
  );
  await page.mouse.up();
  expect((await box.boundingBox())!.width).toBeGreaterThan(before!.width);
  expect(
    await page.evaluate(() =>
      Number(localStorage.getItem("guardian-message-scale")),
    ),
  ).toBeGreaterThan(1);
  await page.getByRole("button", { name: "Engineer", exact: true }).click();
  await page
    .getByRole("button", { name: "Processing controls", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Set analysis region", exact: true })
    .click();
  await page
    .getByRole("slider", { name: "Right crop boundary", exact: true })
    .focus();
  await page.keyboard.press("ArrowLeft");
  await page.getByRole("button", { name: "Apply region", exact: true }).click();
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("button", { name: "Edit analysis region", exact: true }),
  ).toBeVisible();
});
test("raw document edits immediately replace the right-panel workflow", async ({
  page,
}) => {
  await workspace(page, true, false);
  await page.getByRole("button", { name: "Read / edit document" }).click();
  await page
    .locator("textarea")
    .fill(
      "Step 1: Inspect the package\nActions: Check the label\nCriteria: Label visible\nSafety: Never skip the label check",
    );
  await page
    .getByRole("button", { name: "Save & re-parse table", exact: true })
    .click();
  await page.keyboard.press("Escape");
  await expect(
    page.getByText("Inspect the package", { exact: true }),
  ).toBeVisible();
  await expect(page.getByTestId("step-S2")).toHaveCount(0);
});
test("all original sample documents remain selectable", async ({ page }) => {
  await page.goto("/");
  await page
    .getByRole("combobox", { name: "Choose a sample guidance document" })
    .click();
  expect(await page.getByRole("option").allTextContents()).toEqual(
    expect.arrayContaining([
      "Bankart",
      "Bankart simple",
      "bankart completion criteria only",
      "bankart simplified completion criteria",
      "Cholecystectomy",
      "Coffee Brewing",
      "dataParametersLogic",
      "dataParametersLogicStructured",
    ]),
  );
  await page
    .getByRole("option", { name: "Cholecystectomy", exact: true })
    .click();
  await expect(
    page.getByText("Cholecystectomy.txt · 6 steps extracted"),
  ).toBeVisible();
  await page.getByRole("button", { name: "Open workspace" }).click();
  await expect(page.getByTestId("step-S6")).toBeVisible();
});
test("provider failure shows a useful retry message and keeps progress unknown", async ({
  page,
}) => {
  await page.route("**/api/guidance/analyze", (route) =>
    route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({
        ok: false,
        error: "Test provider temporarily unavailable",
      }),
    }),
  );
  await workspace(page);
  await expect(
    page
      .getByText("Test provider temporarily unavailable", { exact: false })
      .first(),
  ).toBeVisible();
  await expect(
    page.getByText("0 / 2 confirmed", { exact: true }),
  ).toBeVisible();
});
test("demo mode cannot claim visual completion", async ({ page }) => {
  await workspace(page, true, false);
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("switch", { name: "Demo mode", exact: true }).click();
  await page.keyboard.press("Escape");
  await page.getByTestId("workspace-video-input").setInputFiles(video);
  await page
    .getByRole("button", { name: "Start guidance", exact: true })
    .click();
  await expect(
    page
      .getByText("Demo mode: no AI observation was performed.", {
        exact: false,
      })
      .first(),
  ).toBeVisible();
  await expect(
    page.getByText("0 / 2 confirmed", { exact: true }),
  ).toBeVisible();
});
test("compact desktop and dark appearance stay usable", async ({ page }) => {
  await page.setViewportSize({ width: 1100, height: 800 });
  await workspace(page, true, false);
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page
    .getByRole("switch", { name: "Dark appearance", exact: true })
    .click();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toBeHidden();
  await expect(page.locator("html")).toHaveClass(/dark/);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "test-results/workspace-dark-1100.png",
    fullPage: true,
  });
});

test("Guardian clears resolved concerns and reports a later recurrence", async ({
  page,
}) => {
  await workspace(page);
  const concern = page.getByText(
    "Test fixture: review the visible work area.",
    { exact: true },
  );
  await expect(concern).toBeVisible();
  let status = "ok";
  await page.route("**/api/guidance/analyze", async (route) => {
    const response = await route.fetch();
    const body = await response.json();
    body.observation.status = status;
    body.observation.concern =
      status === "ok" ? "" : "Test fixture: review the visible work area.";
    await route.fulfill({ response, json: body });
  });
  await page
    .getByRole("button", { name: "Analyze current view", exact: true })
    .click();
  await expect(concern).toBeHidden();
  status = "watch";
  await page
    .getByRole("button", { name: "Analyze current view", exact: true })
    .click();
  await expect(concern).toBeVisible();
  await expect(
    page.locator(
      '[data-guardian-message="Guardian safety message"] .bg-warning',
    ),
  ).toBeVisible();
});
