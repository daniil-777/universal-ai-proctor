import { expect, test, type Page, type Route } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { texturedFrame } from "../../backend/tests/fixtures";
import { api, setup, tool } from "./review-helpers";

test.use({
  browserName: "webkit",
  channel: "",
  launchOptions: {},
  viewport: { width: 1440, height: 1000 },
});

const clipPattern = "**/api/review/incidents/*/clip?**";
const samplesOption = /Uncomplicated cholecystectomy/;

async function writeApi(
  page: Page,
  route: string,
  method: string,
  body: object,
) {
  const result = await page.evaluate(
    async ({ route, method, body }) => {
      const response = await fetch(route, {
        method,
        headers: {
          "Content-Type": "application/json",
          "X-Guidance-Session": sessionStorage.getItem(
            "process-guide-session",
          )!,
        },
        body: JSON.stringify(body),
      });
      return { status: response.status, body: await response.json() };
    },
    { route, method, body },
  );
  expect(result.status).toBe(200);
  expect(result.body.ok).toBe(true);
  return result.body;
}

async function pause(page: Page) {
  const control = page.getByRole("button", {
    name: "Pause guidance",
    exact: true,
  });
  if (await control.isVisible()) await control.click();
  else {
    await page.getByRole("button", { name: "Sources and setup" }).click();
    if (await control.isVisible()) await control.click();
    await page
      .getByRole("button", { name: "Close sources", exact: true })
      .click();
  }
  await page
    .locator("video")
    .first()
    .evaluate((video) => (video as HTMLVideoElement).pause());
}

async function sourceControls(page: Page) {
  const select = page.getByRole("combobox", {
    name: "Choose a sample video",
    exact: true,
  });
  // A report can be layered over the mobile Sources sheet. Wait for its close
  // transition to restore that existing sheet before deciding to open it.
  if (!(await select.isVisible()))
    await select.waitFor({ state: "visible", timeout: 1000 }).catch(() => {});
  if (!(await select.isVisible()))
    await page.getByRole("button", { name: "Sources and setup" }).click();
  await expect(select).toBeEnabled();
  return select;
}

async function selectSurgery(page: Page) {
  const select = await sourceControls(page);
  await select.click();
  const option = page.getByRole("option", { name: samplesOption });
  await expect(option).toContainText("Original default");
  await expect(option).toContainText("4:12");
  await option.click();
  await expect
    .poll(async () => (await api(page, "/api/session")).filename)
    .toBe("Cholecystectomy.txt");
}

async function openReport(page: Page) {
  const button = page.getByRole("button", { name: "Report", exact: true });
  if (!(await button.isVisible()))
    await page.getByRole("button", { name: "Sources and setup" }).click();
  await button.click();
  const dialog = page.getByRole("dialog");
  await expect(
    dialog.getByRole("heading", { name: "Session report", exact: true }),
  ).toBeVisible();
  await dialog
    .getByRole("navigation", { name: "Report sections", exact: true })
    .getByRole("button", { name: "Guardian clips", exact: true })
    .click();
  const library = dialog.getByRole("region", {
    name: "Guardian clip library",
    exact: true,
  });
  await expect(library).toBeFocused();
  return { dialog, library };
}

async function seedFindings(page: Page) {
  await setup(page);
  const session = await api(page, "/api/session");
  await writeApi(page, "/api/guidance/analyze", "POST", {
    source_id: session.source_id,
    current_s: 8,
    frames_b64: [await texturedFrame(101)],
    frame_times_s: [8],
    demo: false,
  });
  const document = await api(page, "/api/reference/document");
  await writeApi(page, "/api/reference/document", "PUT", {
    text: document.text + "\n\nTest marker: FOR_REVIEW_ALERT",
    reparse: true,
  });
  await writeApi(page, "/api/guidance/analyze", "POST", {
    source_id: session.source_id,
    current_s: 12,
    frames_b64: [await texturedFrame(102)],
    frame_times_s: [12],
    demo: false,
  });
  await page.reload();
  await page
    .getByRole("button", { name: "Open workspace", exact: true })
    .click();
  await expect
    .poll(() =>
      page
        .locator("video")
        .first()
        .evaluate((element) => (element as HTMLVideoElement).readyState),
    )
    .toBeGreaterThanOrEqual(2);
  await pause(page);
  const review = await api(page, "/api/review?include_images=false");
  expect(
    review.events.some(
      (event: { status: string; video_time_s: number }) =>
        event.status === "watch" && event.video_time_s === 8,
    ),
  ).toBe(true);
  expect(
    review.events.some(
      (event: { status: string; video_time_s: number }) =>
        event.status === "alert" && event.video_time_s === 12,
    ),
  ).toBe(true);
  return review;
}

async function capture(page: Page, name: string) {
  const directory = path.resolve("../docs/screenshots");
  await fs.mkdir(directory, { recursive: true });
  await expect(
    page
      .getByRole("dialog")
      .getByRole("button", { name: "Close", exact: true }),
  ).toBeInViewport();
  expect(
    await page
      .getByRole("dialog")
      .evaluate((element) => element.scrollWidth <= element.clientWidth + 1),
  ).toBe(true);
  await page.screenshot({ path: path.join(directory, name + ".png") });
}

test("original surgery sample opens from onboarding with preserved guidance and real decoded duration", async ({
  page,
}) => {
  test.setTimeout(60000);
  const requests: string[] = [];
  page.on("request", (request) =>
    requests.push(new URL(request.url()).pathname),
  );
  await page.goto("/");
  expect(requests.filter((route) => route === "/api/video/stream")).toEqual([]);
  await selectSurgery(page);
  await expect(
    page.getByText(/Cholecystectomy\.txt · \d+ steps extracted/),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Open workspace", exact: true })
    .click();
  await expect
    .poll(() =>
      page
        .locator("video")
        .first()
        .evaluate((element) => (element as HTMLVideoElement).readyState),
    )
    .toBeGreaterThanOrEqual(2);
  await pause(page);
  const media = await page
    .locator("video")
    .first()
    .evaluate((element) => ({
      duration: (element as HTMLVideoElement).duration,
      width: (element as HTMLVideoElement).videoWidth,
      src: (element as HTMLVideoElement).currentSrc,
    }));
  // WebKit includes one final 30 fps presentation frame beyond ffprobe's
  // format duration. The actual file and API duration are tested separately.
  expect(media.duration).toBeCloseTo(252.766667, 1);
  expect(media.width).toBe(660);
  expect(media.src).toContain("/api/video/stream");
  const session = await api(page, "/api/session");
  expect(session.source_name).toBe("Uncomplicated cholecystectomy");
  expect(session.filename).toBe("Cholecystectomy.txt");
  expect(session.workflow.steps.length).toBeGreaterThan(3);
  expect(
    session.workflow.steps.every(
      (step: { complete: boolean }) => !step.complete,
    ),
  ).toBe(true);
  const originalInstructions = await fs.readFile(
    path.resolve("../../AI-Proctor/llmDescription/Cholecystectomy.txt"),
    "utf8",
  );
  expect((await api(page, "/api/reference/document")).text).toBe(
    originalInstructions,
  );
  const sourceBlocks = originalInstructions
    .replace(/\r\n/g, "\n")
    .split(/(?=^STEP \d+\s*[—–-])/m)
    .filter((block) => /^STEP \d+/.test(block));
  expect(session.workflow.steps).toHaveLength(sourceBlocks.length);
  for (const [index, block] of sourceBlocks.entries()) {
    const step = session.workflow.steps[index];
    expect(step.actions.length).toBeGreaterThan(0);
    expect(step.criteria.length).toBeGreaterThan(0);
    if (/^Objective\s*$/m.test(block))
      expect(step.objective.length).toBeGreaterThan(0);
    if (/^Instruments Visible\s*$/m.test(block))
      expect(step.expectedInstruments.length).toBeGreaterThan(0);
  }
  expect(session.workflow.steps[2].actions).toContain("Pause.");
  expect(session.workflow.steps[2].actions).toContain(
    "Confirm absence of additional ducts.",
  );
  expect(session.workflow.steps[3].actions).toContain(
    "Isolate artery clearly.",
  );
  expect(
    session.workflow.steps[3].criteria.some(
      (criterion: { label: string }) =>
        criterion.label === "No pulsatile bleeding",
    ),
  ).toBe(true);

  const sought = page.waitForResponse(
    (response) =>
      response.url().includes("/api/workflow/seek") && response.ok(),
  );
  await page
    .locator("video")
    .first()
    .evaluate((element) => {
      (element as HTMLVideoElement).currentTime = 30;
    });
  await sought;
  await expect
    .poll(() =>
      page
        .locator("video")
        .first()
        .evaluate((element) => {
          const video = element as HTMLVideoElement;
          return (
            !video.seeking &&
            video.readyState >= 2 &&
            Math.abs(video.currentTime - 30) < 0.1
          );
        }),
    )
    .toBe(true);
  const observed = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/guidance/analyze") && response.ok(),
  );
  await page
    .getByRole("button", { name: "Analyze current view", exact: true })
    .click();
  const observationResponse = await observed;
  const observationRequest = observationResponse.request().postDataJSON();
  expect(observationRequest.source_id).toBe(session.source_id);
  expect(observationRequest.current_s).toBeCloseTo(30, 1);
  expect(observationRequest.frames_b64).toEqual([]);
  expect(observationRequest.frame_times_s).toEqual([]);
  expect(observationRequest.n_samples).toBe(4);
  expect(observationRequest.window_s).toBe(5);
  const observation = await observationResponse.json();
  expect(observation.source_id).toBe(session.source_id);
  expect(observation.used_frames).toBe(4);
  const sampledTimes = JSON.parse(
    /Frame timestamps \(seconds, zero-based image order\): (\[[^\n]*?\])/.exec(
      observation.prompt,
    )?.[1] || "[]",
  ) as number[];
  expect(sampledTimes).toHaveLength(4);
  expect(sampledTimes[0]).toBeGreaterThanOrEqual(25);
  expect(sampledTimes[3]).toBeCloseTo(30, 1);
  expect(
    sampledTimes.every(
      (time, index) => index === 0 || time > sampledTimes[index - 1],
    ),
  ).toBe(true);
  expect(observation.prompt).toContain("Exposure of the Gallbladder");
  expect(observation.prompt).toContain("Grasp fundus");
  expect(observation.observation.status).toBe("watch");
  // This provider is a test fixture. It proves routing and grounding, not
  // clinical correctness or that the depicted procedure was performed safely.
  await tool(page, "Steps");
  await page
    .getByRole("button", {
      name: `Confirm ${session.workflow.steps[0].name} manually`,
      exact: true,
    })
    .click();
  const confirmed = (await api(page, "/api/session")).workflow.steps[0];
  expect(confirmed.complete).toBe(true);
  expect(confirmed.confirmation).toBe("manual");
  await page.getByRole("button", { name: "Open chat", exact: true }).click();
  const answered = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/llm/ask/stream") && response.ok(),
  );
  await page
    .getByRole("textbox", { name: "Message", exact: true })
    .fill("What is the documented objective for the current surgical step?");
  await page.getByRole("button", { name: "Send message", exact: true }).click();
  const answerResponse = await answered;
  const answerRequest = answerResponse.request().postDataJSON();
  expect(answerRequest.frames_b64 ?? []).toEqual([]);
  expect(answerRequest.frame_times_s ?? []).toEqual([]);
  expect(answerRequest.source_id).toBe(session.source_id);
  expect(answerRequest.window_s).toBe(4);
  expect(await answerResponse.text()).toContain("Exposure of the Gallbladder");
  await expect(page.locator(".chat-panel")).toContainText(
    "The visible tool is on the table.",
  );
  await page.getByRole("button", { name: "Close chat", exact: true }).click();
  await tool(page, "Review");
  await page
    .getByLabel("Evidence bookmark note")
    .fill("Original surgical video: review the recorded frame at 30 seconds.");
  await page.getByRole("button", { name: "Save frame", exact: true }).click();
  await expect(
    page
      .getByRole("article")
      .filter({
        hasText:
          "Original surgical video: review the recorded frame at 30 seconds.",
      })
      .locator("img"),
  ).toHaveCount(1);
  const { dialog, library } = await openReport(page);
  // Server sampling retains the exact decoded presentation timestamp. A seek
  // at30 s can end at29.9667 s, whose whole-second report label is00:29.
  const findingSecond = String(Math.floor(sampledTimes.at(-1)!)).padStart(
    2,
    "0",
  );
  await expect(
    library.getByRole("button", {
      name: `Prepare clip at 00:${findingSecond}`,
      exact: true,
    }),
  ).toBeVisible();
  await dialog
    .getByRole("navigation", { name: "Report sections", exact: true })
    .getByRole("button", { name: "Evidence", exact: true })
    .click();
  const evidence = dialog.getByRole("region", {
    name: "Recorded evidence",
    exact: true,
  });
  await expect(evidence).toBeFocused();
  await expect(
    evidence.getByRole("heading", { name: "Recorded evidence", exact: true }),
  ).toBeInViewport();
  await evidence
    .getByLabel("Evidence type", { exact: true })
    .selectOption({ label: "Bookmarks" });
  await expect(evidence.locator("img")).toHaveCount(1);
  await expect(evidence.locator("img")).toBeInViewport();
  await capture(page, "surgery-default-report-recorded-frame");
  expect(requests.filter((route) => route === "/api/video/upload")).toEqual([]);
  expect(
    requests.filter((route) => route === "/api/video/load-sample"),
  ).toHaveLength(1);
});

test.describe("original surgery sample on 320 px phone", () => {
  test.use({
    viewport: { width: 320, height: 740 },
    isMobile: true,
    hasTouch: true,
  });
  test("Sources sample menu replaces uploaded video and paired instructions without upload", async ({
    page,
  }) => {
    await setup(page);
    const original = await api(page, "/api/session");
    let uploaded = 0;
    page.on("request", (request) => {
      if (new URL(request.url()).pathname === "/api/video/upload") uploaded++;
    });
    await selectSurgery(page);
    const close = page.getByRole("button", {
      name: "Close sources",
      exact: true,
    });
    if (await close.isVisible()) await close.click();
    await expect
      .poll(() =>
        page
          .locator("video")
          .first()
          .evaluate((element) => (element as HTMLVideoElement).readyState),
      )
      .toBeGreaterThanOrEqual(2);
    expect(
      await page
        .locator("video")
        .first()
        .evaluate((element) => (element as HTMLVideoElement).duration),
    ).toBeCloseTo(252.766667, 1);
    const current = await api(page, "/api/session");
    expect(current.source_id).not.toBe(original.source_id);
    expect(current.filename).toBe("Cholecystectomy.txt");
    expect(current.source_name).toBe("Uncomplicated cholecystectomy");
    expect(uploaded).toBe(0);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
    ).toBe(true);
    await page.screenshot({
      path: path.resolve("../docs/screenshots/surgery-sample-small-phone.png"),
    });
  });
});

test("Guardian finding library prepares only an explicit guarded clip, decodes, downloads and releases playback", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const revoke = URL.revokeObjectURL.bind(URL);
    Object.assign(window, { __guardianRevoked: [] as string[] });
    URL.revokeObjectURL = (url) => {
      (
        window as Window & { __guardianRevoked: string[] }
      ).__guardianRevoked.push(url);
      revoke(url);
    };
    Object.defineProperty(navigator, "canShare", {
      configurable: true,
      value: () => true,
    });
    Object.defineProperty(navigator, "share", {
      configurable: true,
      value: async (data: ShareData) => {
        Object.assign(window, {
          __guardianShared: {
            type: data.files![0].type,
            name: data.files![0].name,
            size: data.files![0].size,
          },
        });
      },
    });
  });
  const review = await seedFindings(page);
  const clipRequests: string[] = [],
    aiRequests: string[] = [],
    errors: string[] = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (/\/api\/review\/incidents\/.+\/clip$/.test(url.pathname))
      clipRequests.push(request.url());
    if (/^\/api\/(?:guidance\/analyze|llm\/|tts)/.test(url.pathname))
      aiRequests.push(url.pathname);
  });
  page.on("pageerror", (error) => errors.push(error.message));
  expect(
    await page.evaluate(() =>
      performance
        .getEntriesByType("resource")
        .some((entry) =>
          /\/assets\/ReportDialog-[^/]+\.js$/.test(
            new URL(entry.name).pathname,
          ),
        ),
    ),
  ).toBe(false);
  const { dialog, library } = await openReport(page);
  await expect(
    library.getByRole("button", { name: "Prepare clip at 00:08", exact: true }),
  ).toBeVisible();
  await expect(
    library.getByRole("button", { name: "Prepare clip at 00:12", exact: true }),
  ).toBeVisible();
  await expect(library).toContainText("not confirmed errors");
  expect(clipRequests).toEqual([]);
  await expect(library.locator("video")).toHaveCount(0);
  await library
    .getByLabel("Guardian finding type", { exact: true })
    .selectOption({ label: "Watches" });
  await expect(
    library.getByRole("button", { name: "Prepare clip at 00:08", exact: true }),
  ).toBeVisible();
  await expect(
    library.getByRole("button", { name: "Prepare clip at 00:12", exact: true }),
  ).toHaveCount(0);
  await expect(library).toContainText("Recorded against earlier instructions");
  await capture(page, "guardian-library-watch-findings");
  await library
    .getByLabel("Guardian finding type", { exact: true })
    .selectOption({ label: "Alerts" });
  await library
    .getByRole("button", { name: "Prepare clip at 00:12", exact: true })
    .click();
  const preview = library.getByRole("region", {
    name: "Guardian clip preview",
    exact: true,
  });
  await expect(preview).toBeFocused();
  const video = preview.locator("video");
  await expect
    .poll(() =>
      video.evaluate((element) => (element as HTMLVideoElement).readyState),
    )
    .toBeGreaterThanOrEqual(1);
  expect(
    await video.evaluate((element) => (element as HTMLVideoElement).paused),
  ).toBe(true);
  expect(
    await video.evaluate((element) => (element as HTMLVideoElement).duration),
  ).toBeCloseTo(9, 0);
  expect(clipRequests).toHaveLength(1);
  const query = new URL(clipRequests[0]).searchParams;
  expect(query.get("source_id")).toBe(review.source_id);
  expect(query.get("reference_key")).toBe(review.reference_key);
  await preview
    .getByRole("button", { name: "Share clip", exact: true })
    .click();
  const shared = await page.evaluate(
    () =>
      (
        window as Window & {
          __guardianShared: { type: string; name: string; size: number };
        }
      ).__guardianShared,
  );
  expect(shared.type).toBe("video/mp4");
  expect(shared.name).toBe("guardian-alert-00m12s.mp4");
  expect(shared.size).toBeGreaterThan(1000);
  const download = page.waitForEvent("download");
  await preview
    .getByRole("button", { name: "Download clip", exact: true })
    .click();
  const file = await download;
  expect(file.suggestedFilename()).toBe("guardian-alert-00m12s.mp4");
  const probe = JSON.parse(
    execFileSync(
      "ffprobe",
      [
        "-v",
        "error",
        "-show_entries",
        "format=duration",
        "-of",
        "json",
        (await file.path())!,
      ],
      { encoding: "utf8" },
    ),
  );
  expect(Number(probe.format.duration)).toBeCloseTo(9, 0);
  await video.evaluate((element) => (element as HTMLVideoElement).play());
  await expect
    .poll(() =>
      video.evaluate((element) => (element as HTMLVideoElement).paused),
    )
    .toBe(false);
  await expect
    .poll(() =>
      video.evaluate((element) => (element as HTMLVideoElement).readyState),
    )
    .toBeGreaterThanOrEqual(2);
  await capture(page, "guardian-library-alert-preview");
  const element = await video.elementHandle();
  const clipUrl = await video.getAttribute("src");
  await dialog.getByRole("button", { name: "Close", exact: true }).click();
  await expect(
    page.getByRole("region", { name: "Guardian clip preview", exact: true }),
  ).toHaveCount(0);
  await expect
    .poll(() =>
      element!.evaluate((media) => ({
        paused: (media as HTMLVideoElement).paused,
        attached: media.isConnected,
        src: media.getAttribute("src"),
      })),
    )
    .toEqual({ paused: true, attached: false, src: null });
  expect(
    await page.evaluate(
      (url) =>
        (
          window as Window & { __guardianRevoked: string[] }
        ).__guardianRevoked.includes(url!),
      clipUrl,
    ),
  ).toBe(true);
  expect(aiRequests).toEqual([]);
  expect(errors).toEqual([]);
});

test.describe("Guardian clip cancellation on tablet", () => {
  test.use({
    viewport: { width: 820, height: 1180 },
    isMobile: true,
    hasTouch: true,
  });
  test("a delayed prior-source clip never reappears after close and loading the surgery sample", async ({
    page,
  }) => {
    const review = await seedFindings(page);
    let release!: () => void;
    let handled!: () => void;
    let fetched!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const finished = new Promise<void>((resolve) => {
      handled = resolve;
    });
    const responseReady = new Promise<void>((resolve) => {
      fetched = resolve;
    });
    let clipSource = "";
    await page.route(clipPattern, async (route: Route) => {
      clipSource =
        new URL(route.request().url()).searchParams.get("source_id") || "";
      const response = await route.fetch();
      expect(response.ok()).toBe(true);
      fetched();
      await gate;
      try {
        await route.fulfill({ response });
      } catch {
        /* The modal legitimately aborted this request. */
      }
      handled();
    });
    const { dialog, library } = await openReport(page);
    const requested = page.waitForRequest((request) =>
      /\/api\/review\/incidents\/.+\/clip\?/.test(request.url()),
    );
    await library
      .getByRole("button", { name: "Prepare clip at 00:12", exact: true })
      .click();
    await requested;
    await responseReady;
    await expect(
      library.getByRole("button", {
        name: "Prepare clip at 00:12",
        exact: true,
      }),
    ).toBeDisabled();
    await dialog.getByRole("button", { name: "Close", exact: true }).click();
    await expect(
      page.getByRole("region", { name: "Guardian clip library", exact: true }),
    ).toHaveCount(0);
    await selectSurgery(page);
    const current = await api(page, "/api/session");
    expect(current.source_id).not.toBe(review.source_id);
    expect(clipSource).toBe(review.source_id);
    release();
    await finished;
    await page.unroute(clipPattern);
    const replacement = await openReport(page);
    await expect(
      replacement.library.getByRole("region", {
        name: "Guardian clip preview",
        exact: true,
      }),
    ).toHaveCount(0);
    await expect(
      replacement.library.getByRole("button", { name: /Prepare clip at/ }),
    ).toHaveCount(0);
    await expect(replacement.library).toContainText(
      "No unusual observations or alerts were retained for this source",
    );
    await capture(page, "guardian-library-tablet-source-replacement");
  });
});
