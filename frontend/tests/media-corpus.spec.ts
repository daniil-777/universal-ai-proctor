import { test, expect } from "@playwright/test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
const directory = fs.mkdtempSync(
  path.join(os.tmpdir(), "process-guide-media-ui-"),
);
const cases = [
  {
    name: "portrait.mp4",
    size: "360x640",
    codec: "libx264",
    doc: "unicode.txt",
    text: "Step 1: Подготовка\nActions: Проверить инструмент\nCriteria: Инструмент виден\nStep 2: Finish\nActions: Store tool",
    steps: 2,
  },
  {
    name: "wide.mp4",
    size: "960x240",
    codec: "libx264",
    doc: "process.md",
    text: "# Prepare\nActions: Inspect tool\n## Finish\nActions: Store tool",
    steps: 2,
  },
  {
    name: "process.webm",
    size: "428x240",
    codec: "libvpx-vp9",
    doc: null,
    text: "",
    steps: 3,
  },
  {
    name: "quicktime.mov",
    size: "640x360",
    codec: "libx264",
    doc: "process.csv",
    text: "step,actions,criteria,principles\nPrepare,Place the tool,Tool visible,Always inspect the area",
    steps: 1,
  },
];
test.beforeAll(() => {
  for (const spec of cases)
    execFileSync("ffmpeg", [
      "-loglevel",
      "error",
      "-f",
      "lavfi",
      "-i",
      `testsrc2=s=${spec.size}:r=12`,
      "-t",
      "4",
      "-c:v",
      spec.codec,
      "-pix_fmt",
      "yuv420p",
      "-y",
      path.join(directory, spec.name),
    ]);
});
test.afterAll(() => fs.rmSync(directory, { recursive: true, force: true }));
for (const spec of cases)
  test(`plays ${spec.name} and preserves its ${spec.doc || "documentless"} guidance`, async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto("/");
    if (spec.doc) {
      await page
        .getByTestId("intro-document-input")
        .setInputFiles({
          name: spec.doc,
          mimeType: "text/plain",
          buffer: Buffer.from(spec.text),
        });
      await expect(
        page.getByText(`${spec.doc} · ${spec.steps} steps extracted`, {
          exact: true,
        }),
      ).toBeVisible();
    }
    await page
      .getByTestId("intro-video-input")
      .setInputFiles(path.join(directory, spec.name));
    await page
      .getByRole("button", { name: "Open workspace", exact: true })
      .click();
    const video = page.locator("video").first();
    await expect
      .poll(() => video.evaluate((v) => (v as HTMLVideoElement).readyState))
      .toBeGreaterThanOrEqual(2);
    const [width, height] = spec.size.split("x").map(Number);
    expect(
      await video.evaluate((v) => [
        (v as HTMLVideoElement).videoWidth,
        (v as HTMLVideoElement).videoHeight,
      ]),
    ).toEqual([width, height]);
    await expect
      .poll(() => video.evaluate((v) => (v as HTMLVideoElement).currentTime))
      .toBeGreaterThan(0);
    await expect(page.getByTestId(`step-S${spec.steps}`)).toBeVisible();
    await expect(page.getByTestId(`step-S${spec.steps + 1}`)).toHaveCount(0);
    if (spec.doc === "process.csv") {
      await page.getByRole("tab", { name: "Principles", exact: true }).click();
      await expect(
        page.getByText("Always inspect the area", { exact: true }),
      ).toBeVisible();
    }
    if (!spec.doc)
      await expect(
        page.getByText("Provisional", { exact: true }),
      ).toBeVisible();
    await page
      .getByRole("button", { name: "Pause video", exact: true })
      .click();
    expect(await video.evaluate((v) => (v as HTMLVideoElement).paused)).toBe(
      true,
    );
    expect(errors).toEqual([]);
  });
test("a hundred-step guidance document remains usable and reports omitted steps", async ({
  page,
}) => {
  await page.goto("/");
  const text = Array.from(
    { length: 130 },
    (_, i) =>
      `Step ${i + 1}: Action ${i + 1}\nActions: Inspect item ${i + 1}\nCriteria: Item ${i + 1} visible`,
  ).join("\n");
  await page
    .getByTestId("intro-document-input")
    .setInputFiles({
      name: "Long process.txt",
      mimeType: "text/plain",
      buffer: Buffer.from(text),
    });
  await expect(
    page.getByText("Long process.txt · 100 steps extracted", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Open workspace", exact: true })
    .click();
  await expect(
    page.getByText("Only the first 100 steps are shown.", { exact: false }),
  ).toBeVisible();
  await page.getByTestId("step-S100").scrollIntoViewIfNeeded();
  await expect(page.getByTestId("step-S100")).toBeVisible();
  await expect(
    page.getByRole("progressbar", {
      name: "Confirmed process steps",
      exact: true,
    }),
  ).toHaveAttribute("aria-valuenow", "0");
});
