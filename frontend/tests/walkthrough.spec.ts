import { expect, test, type Page } from "@playwright/test";
import path from "node:path";
import fs from "node:fs/promises";

// A real local playback fixture keeps integration tests independent of the authored narration render.
const fixtureVideo = path.resolve("public/media/process-guide-tour.mp4");
const fixturePoster = path.resolve("public/media/process-guide-tour.jpg");
const metadata = {
  title: "Walkthrough playback fixture",
  duration_s: 90,
  language: "en",
  captions_burned_in: true,
  chapters: [
    { id: "source", title: "Choose a source", start_s: 0, end_s: 10 },
    { id: "review", title: "Review recorded evidence", start_s: 10, end_s: 90 },
  ],
  transcript: [
    {
      start_s: 0,
      end_s: 10,
      text: "Choose a recorded video, camera or screen using the setup controls.",
    },
    {
      start_s: 10,
      end_s: 90,
      text: "Review recorded evidence and unresolved issues before confirming the process steps.",
    },
  ],
};
async function mediaFixture(
  page: Page,
  failVideo: () => boolean = () => false,
) {
  const bytes = await fs.readFile(fixtureVideo);
  await page.route("**/media/process-guide-walkthrough.json", (route) =>
    route.fulfill({ json: metadata }),
  );
  await page.route("**/media/process-guide-walkthrough-poster.jpg", (route) =>
    route.fulfill({ path: fixturePoster, contentType: "image/jpeg" }),
  );
  await page.route("**/media/process-guide-walkthrough.vtt", (route) =>
    route.fulfill({
      contentType: "text/vtt",
      body: "WEBVTT\n\n00:00.000 --> 00:10.000\nChoose a source.\n\n00:10.000 --> 00:20.000\nReview the evidence.\n",
    }),
  );
  await page.route("**/media/process-guide-walkthrough.mp4", (route) => {
    if (failVideo()) return route.fulfill({ status: 404, body: "Unavailable" });
    const range = route
      .request()
      .headers()
      .range?.match(/^bytes=(\d+)-(\d*)$/);
    const start = range ? Number(range[1]) : 0;
    const end = range?.[2]
      ? Math.min(Number(range[2]), bytes.length - 1)
      : bytes.length - 1;
    if (start > end)
      return route.fulfill({
        status: 416,
        headers: { "Content-Range": `bytes */${bytes.length}` },
      });
    return route.fulfill({
      status: range ? 206 : 200,
      contentType: "video/mp4",
      body: bytes.subarray(start, end + 1),
      headers: {
        "Accept-Ranges": "bytes",
        "Content-Length": String(end - start + 1),
        ...(range
          ? { "Content-Range": `bytes ${start}-${end}/${bytes.length}` }
          : {}),
      },
    });
  });
}

test("full walkthrough remains lazy, pauses the homepage demo, plays and seeks without changing the analysis source", async ({
  page,
}) => {
  const requests: string[] = [],
    errors: string[] = [];
  page.on("request", (request) => requests.push(request.url()));
  page.on("pageerror", (error) => errors.push(error.message));
  await mediaFixture(page);
  await page.goto("/");
  await expect(
    page.getByRole("button", { name: "See full walkthrough" }),
  ).toBeVisible();
  expect(
    requests.filter((url) => url.includes("process-guide-walkthrough")),
  ).toEqual([]);
  await page
    .getByRole("button", { name: "Play 63-second Leica UI and voice demo" })
    .click();
  const quick = page.getByTestId("intro-tour-video");
  await expect
    .poll(() => quick.evaluate((video: HTMLVideoElement) => video.currentTime))
    .toBeGreaterThan(0.2);
  await page.getByRole("button", { name: "See full walkthrough" }).click();
  const video = page.getByTestId("walkthrough-video");
  await expect(video).toBeVisible();
  await expect(quick).toHaveJSProperty("paused", true);
  await expect(video).not.toHaveAttribute("src");
  expect(
    requests.filter((url) => url.includes("process-guide-walkthrough.mp4")),
  ).toEqual([]);
  await page.getByRole("button", { name: "Play narrated walkthrough" }).click();
  await expect
    .poll(() =>
      video.evaluate((element: HTMLVideoElement) => element.currentTime),
    )
    .toBeGreaterThan(0.2);
  expect(
    await video.evaluate((element: HTMLVideoElement) => [
      element.muted,
      element.playsInline,
      element.controls,
      element.preload,
    ]),
  ).toEqual([false, true, true, "none"]);
  await expect(video.locator("track")).not.toHaveAttribute("default");
  await video.locator("track").evaluate((track: HTMLTrackElement) => {
    track.track.mode = "hidden";
  });
  await expect
    .poll(() =>
      video
        .locator("track")
        .evaluate((track: HTMLTrackElement) => track.readyState),
    )
    .toBe(2);
  await page
    .getByRole("button", { name: "Pause narrated walkthrough" })
    .click();
  await page
    .getByRole("button", { name: "0:10 Review recorded evidence" })
    .click();
  await expect
    .poll(() =>
      video.evaluate((element: HTMLVideoElement) => element.currentTime),
    )
    .toBeCloseTo(10, 0);
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await expect(video).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "See full walkthrough" }),
  ).toBeFocused();
  await page.getByRole("button", { name: "Open workspace" }).click();
  await expect(
    page.getByRole("button", { name: "Analyze current view", exact: true }),
  ).toBeDisabled();
  expect(
    requests.filter((url) =>
      /\/api\/(guidance\/analyze|video\/upload|source)/.test(url),
    ),
  ).toEqual([]);
  expect(errors).toEqual([]);
});

test("failed walkthrough playback has a real transcript and an explicit working retry", async ({
  page,
}) => {
  let failing = true;
  await mediaFixture(page, () => failing);
  await page.goto("/");
  await page.getByRole("button", { name: "See full walkthrough" }).click();
  await page.getByRole("button", { name: "Play narrated walkthrough" }).click();
  await expect(page.getByRole("alert")).toContainText(/could not (play|start)/);
  await expect(
    page.getByRole("button", { name: "Retry walkthrough" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Read transcript" }).click();
  await expect(page.getByText(metadata.transcript[1].text)).toBeVisible();
  failing = false;
  await page.getByRole("button", { name: "Retry walkthrough" }).click();
  await expect
    .poll(() =>
      page
        .getByTestId("walkthrough-video")
        .evaluate((video: HTMLVideoElement) => video.currentTime),
    )
    .toBeGreaterThan(0.2);
  await expect(page.getByRole("alert")).toHaveCount(0);
});

test("320px walkthrough keeps close visible while scrolling and remains accessible from mobile settings", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.setViewportSize({ width: 320, height: 568 });
  await mediaFixture(page);
  await page.goto("/");
  await page.getByRole("button", { name: "See full walkthrough" }).click();
  const dialog = page.locator(".workspace-walkthrough-dialog");
  await expect(dialog).toHaveCSS("padding", "0px");
  await expect(
    page.getByRole("button", { name: "0:10 Review recorded evidence" }),
  ).toBeVisible();
  await page.getByText("Transcript and written guide").click();
  await page.getByText(metadata.transcript[1].text).scrollIntoViewIfNeeded();
  const close = page.getByRole("button", { name: "Close", exact: true });
  await expect(close).toBeInViewport();
  await expect(
    page.getByRole("heading", { name: "Cueveris walkthrough" }),
  ).toBeInViewport();
  expect(
    await dialog.evaluate(
      (element) => element.scrollWidth <= element.clientWidth,
    ),
  ).toBe(true);
  const heights = await dialog
    .locator("button")
    .evaluateAll((elements) =>
      elements.map((element) => element.getBoundingClientRect().height),
    );
  expect(heights.every((height) => height >= 44)).toBe(true);
  await close.click();
  await expect(
    page.getByRole("button", { name: "See full walkthrough" }),
  ).toBeFocused();
  await page.getByRole("button", { name: "Open workspace" }).click();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("button", { name: "See full walkthrough" }).click();
  await expect(page.getByTestId("walkthrough-video")).toBeVisible();
  await page
    .locator(".workspace-walkthrough-dialog")
    .getByRole("button", { name: "Close", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Workspace settings" }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  expect(errors).toEqual([]);
});

test("phone playback reveals a scrolled player and still releases it when the page is hidden", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await mediaFixture(page);
  await page.goto("/");
  await page.getByRole("button", { name: "Open workspace" }).click();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("button", { name: "See full walkthrough" }).click();
  const dialog = page.locator(".workspace-walkthrough-dialog");
  const video = page.getByTestId("walkthrough-video");
  await video.evaluate(element => {
    const body = element.closest(".overflow-y-auto")!;
    body.scrollTop = body.scrollHeight;
  });
  await dialog.getByRole("button", { name: "Play narrated walkthrough" }).click();
  await expect(video).toBeInViewport();
  await expect.poll(() => video.evaluate((element: HTMLVideoElement) => element.currentTime)).toBeGreaterThan(0.2);
  await page.evaluate(() => {
    Object.defineProperty(document, "hidden", { configurable: true, value: true });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await expect(video).not.toHaveAttribute("src");
  await expect(video).toHaveJSProperty("paused", true);
  await page.evaluate(() => {
    Object.defineProperty(document, "hidden", { configurable: true, value: false });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await expect(video).not.toHaveAttribute("src");
  await expect(dialog.getByRole("button", { name: "Play narrated walkthrough" })).toBeVisible();
});
