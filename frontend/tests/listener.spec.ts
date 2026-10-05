import { test, expect, Page } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(
  new URL("../../evaluation/assets/", import.meta.url),
);
async function workspace(page: Page) {
  await page.goto("/");
  await page
    .getByTestId("intro-video-input")
    .setInputFiles(path.join(root, "parts-sorting.mp4"));
  await page
    .getByTestId("intro-document-input")
    .setInputFiles(path.join(root, "Parts_Sorting.txt"));
  await expect(
    page.getByText("Parts_Sorting.txt · 4 steps extracted"),
  ).toBeVisible();
  await page.getByRole("button", { name: "Open workspace" }).click();
  await expect(page.getByTestId("step-S1")).toBeVisible();
  await page.getByRole("button", { name: /^Pause guidance$/ }).click();
  await page.getByRole("button", { name: "Open chat" }).click();
}
async function recognition(page: Page) {
  await page.addInitScript(() => {
    const w = window as unknown as {
      SpeechRecognition: unknown;
      webkitSpeechRecognition: unknown;
      recognizers: unknown[];
    };
    w.recognizers = [];
    class FakeRecognition {
      onstart: (() => void) | null = null;
      onend: (() => void) | null = null;
      onresult: ((e: unknown) => void) | null = null;
      onerror: ((e: unknown) => void) | null = null;
      constructor() {
        w.recognizers.push(this);
      }
      start() {
        this.onstart?.();
      }
      stop() {
        this.onend?.();
      }
      abort() {}
    }
    w.SpeechRecognition = FakeRecognition;
    w.webkitSpeechRecognition = FakeRecognition;
  });
}
async function utter(page: Page, text: string) {
  await page.evaluate((value) => {
    const w = window as unknown as {
      recognizers: Array<{
        onresult: ((e: unknown) => void) | null;
        onend: (() => void) | null;
      }>;
    };
    const r = w.recognizers.at(-1)!;
    const result = {
      0: { transcript: value, confidence: 1 },
      length: 1,
      isFinal: true,
    };
    r.onresult?.({ resultIndex: 0, results: { 0: result, length: 1 } });
    r.onend?.();
  }, text);
}
test("continuous listener strips wake words, ignores background, streams multiple questions with frame metadata", async ({
  page,
}) => {
  await recognition(page);
  const requests: Array<Record<string, unknown>> = [];
  await page.route("**/api/llm/ask/stream", async (route) => {
    requests.push(route.request().postDataJSON());
    await route.fulfill({
      contentType: "text/event-stream",
      body: 'data: {"delta":"The visible part is blue."}\n\ndata: {"done":true,"used_frames":1}\n\n',
    });
  });
  // Voice output is stubbed separately; this test measures recognized-transcript routing, not hardware STT/TTS.
  await page.route("**/api/tts", (route) =>
    route.fulfill({
      status: 503,
      json: { error: "Speech output unavailable in fixture" },
    }),
  );
  await workspace(page);
  await page
    .getByRole("button", { name: "Listen", exact: true })
    .last()
    .click();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as unknown as { recognizers: unknown[] }).recognizers.length,
      ),
    )
    .toBe(1);
  await utter(
    page,
    "The assistant should hear this ordinary background conversation.",
  );
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as unknown as { recognizers: unknown[] }).recognizers.length,
      ),
    )
    .toBe(2);
  expect(requests).toHaveLength(0);
  for (const text of [
    "Hey, what color is the part in the right bin?",
    "Hi, where should the blue square go?",
    "Hello, how many parts are visible?",
  ]) {
    const before = await page.evaluate(
      () =>
        (window as unknown as { recognizers: unknown[] }).recognizers.length,
    );
    await utter(page, text);
    await expect.poll(() => requests.length).toBeGreaterThan(0);
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            (window as unknown as { recognizers: unknown[] }).recognizers
              .length,
        ),
      )
      .toBeGreaterThan(before);
  }
  expect(requests.map((r) => r.question)).toEqual([
    "what color is the part in the right bin?",
    "where should the blue square go?",
    "how many parts are visible?",
  ]);
  expect(
    requests.every(
      (r) =>
        r.voice === true &&
        typeof r.source_id === "string" &&
        typeof r.revision === "number",
    ),
  ).toBe(true);
  await expect(
    page.getByText("The visible part is blue.", { exact: true }).last(),
  ).toBeVisible();
});
test("microphone permission errors stop listener retries and show an actionable message", async ({
  page,
}) => {
  await recognition(page);
  await workspace(page);
  await page
    .getByRole("button", { name: "Listen", exact: true })
    .last()
    .click();
  await page.evaluate(() => {
    const w = window as unknown as {
      recognizers: Array<{
        onerror: ((e: unknown) => void) | null;
        onend: (() => void) | null;
      }>;
    };
    const r = w.recognizers.at(-1)!;
    r.onerror?.({ error: "not-allowed" });
    r.onend?.();
  });
  await expect(
    page.getByText(
      "Microphone permission was blocked. Allow it in the browser and try again.",
      { exact: true },
    ),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Listen", exact: true }).last(),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () =>
        (window as unknown as { recognizers: unknown[] }).recognizers.length,
    ),
  ).toBe(1);
});
test("source changes cancel pending answers and prevent stale guidance summaries", async ({
  page,
}) => {
  let release!: () => void;
  const held = new Promise<void>((resolve) => (release = resolve));
  let started = false;
  await page.route("**/api/llm/ask/stream", async (route) => {
    started = true;
    await held;
    await route
      .fulfill({
        contentType: "text/event-stream",
        body: 'data: {"delta":"STALE OLD VIDEO ANSWER"}\n\ndata: {"done":true}\n\n',
      })
      .catch(() => {});
  });
  let summaries = 0;
  await page.route("**/api/llm/summarize", async (route) => {
    summaries++;
    await route.fulfill({
      json: { ok: true, summary: "STALE OLD VIDEO ANSWER" },
    });
  });
  await workspace(page);
  await page.getByPlaceholder(/Ask/).fill("What is visible?");
  await page.getByRole("button", { name: "Send message" }).click();
  await expect.poll(() => started).toBe(true);
  await page
    .getByTestId("workspace-video-input")
    .setInputFiles(path.join(root, "control-panel.mp4"));
  await expect(
    page.getByText("Question canceled because the input, workflow or guidance goals changed.", {
      exact: true,
    }),
  ).toBeVisible();
  release();
  await expect(
    page.getByText("STALE OLD VIDEO ANSWER", { exact: true }),
  ).toHaveCount(0);
  expect(summaries).toBe(0);
});
test("Metrics exposes prepared answer comparisons and both channel scores", async ({
  page,
}) => {
  await workspace(page);
  await page.getByRole("button", { name: "Close chat", exact: true }).click();
  await page.route("**/api/evaluation/latest", (route) =>
    route.fulfill({
      json: {
        ok: true,
        available: true,
        model: "benchmark-fixture",
        cases_evaluated: 85,
        metrics: {
          Guardian: {
            cases: 29,
            passed: 20,
            fact_recall: 0.85,
            latency_p50_ms: 4000,
          },
          Listener: {
            cases: 56,
            passed: 50,
            fact_recall: 0.94,
            latency_p50_ms: 1300,
          },
        },
      },
    }),
  );
  await page.getByRole("tab", { name: "Metrics", exact: true }).click();
  await expect(
    page.getByText("85 prepared video cases · benchmark-fixture"),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Compare expected and actual answers" }),
  ).toHaveAttribute("href", /\/evaluation$/);
  await expect(page.getByText("20 / 29", { exact: true })).toBeVisible();
  await expect(page.getByText("50 / 56", { exact: true })).toBeVisible();
});

test("frame controls use the uploaded test video rate instead of assuming 30 fps", async ({
  page,
}) => {
  await workspace(page);
  await page.getByRole("button", { name: "Close chat", exact: true }).click();
  await page.getByRole("button", { name: "Pause video", exact: true }).click();
  const badge = page.locator(".frame-badge");
  await expect(badge).toHaveAttribute("title", /4\.00 fps/);
  await page.locator("video").evaluate((v) => {
    v.currentTime = 4;
  });
  await expect(badge).toHaveText("frame 16");
  await page
    .getByRole("button", { name: "Next video frame", exact: true })
    .click();
  await expect
    .poll(() => page.locator("video").evaluate((v) => v.currentTime))
    .toBeCloseTo(4.25, 2);
  await expect(badge).toHaveText("frame 17");
});
