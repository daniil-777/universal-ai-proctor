import { test, expect } from "@playwright/test";

test("Leica guide opens a real study workspace and analysis waits for an explicitly shared source", async ({ page }) => {
  const analysisRequests: string[] = [];
  page.on("request", request => {
    if (/\/api\/(?:guidance\/analyze|video\/upload|video\/load-sample)/.test(request.url()))
      analysisRequests.push(request.url());
  });
  await page.addInitScript(() => {
    // A browser-produced live capture fixture verifies native-video attachment
    // without depending on the external film or dismissing a real screen picker.
    Object.defineProperty(navigator.mediaDevices, "getDisplayMedia", {
      configurable: true,
      value: async () => {
        const canvas = document.createElement("canvas");
        canvas.width = 640;
        canvas.height = 360;
        const context = canvas.getContext("2d")!;
        context.fillStyle = "#172b35";
        context.fillRect(0, 0, canvas.width, canvas.height);
        context.fillStyle = "white";
        context.font = "20px sans-serif";
        context.fillText("Shared-tab capture fixture", 32, 180);
        return canvas.captureStream(10);
      },
    });
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Use Leica guidance" }).click();
  await expect(page.getByRole("heading", { name: "Leica M10 assembly", exact: true })).toBeVisible();
  await expect(page.getByText("Guide loaded · film not shared", { exact: true })).toBeVisible();
  await expect(page.getByText("The guide is ready for your questions", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Analyze current view", exact: true })).toBeDisabled();
  await expect(page.locator(".video-canvas video")).toHaveCount(0);
  const workflow = await page.evaluate(async () => {
    const response = await fetch("/api/reference", {
      headers: { "X-Guidance-Session": sessionStorage.getItem("process-guide-session")! },
    });
    return response.json();
  });
  expect(workflow.filename).toBe("leica-m10-guidance.txt");
  expect(workflow.workflow.source).toBe("document");
  expect(workflow.workflow.steps.length).toBeGreaterThan(1);
  expect(workflow.workflow.steps.every((step: { complete: boolean; criteria: { status: string }[] }) =>
    !step.complete && step.criteria.every(criterion => criterion.status === "unknown"),
  )).toBe(true);
  expect(analysisRequests).toEqual([]);
  await page.getByRole("button", { name: "Share authorized footage", exact: true }).click();
  await expect(page.getByText("Shared input connected", { exact: true })).toBeVisible();
  const captured = page.locator(".video-canvas video");
  await expect(captured).toBeVisible();
  await expect.poll(() => captured.evaluate((video: HTMLVideoElement) =>
    !!video.srcObject && video.videoWidth > 0 && video.readyState >= 2,
  )).toBe(true);
  await expect(page.getByRole("button", { name: "Analyze current view", exact: true })).toBeEnabled();
  await expect(page.getByRole("button", { name: "Read guidance aloud", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Hear study instructions", exact: true })).toBeVisible();
  expect(analysisRequests).toEqual([]);
});

test("failed Leica guidance keeps the homepage usable and offers an explicit retry", async ({ page }) => {
  let unavailable = true;
  await page.route("**/media/leica-m10-guidance.txt", route => unavailable
    ? route.fulfill({ status: 404, body: "Missing" })
    : route.continue());
  await page.goto("/");
  await page.getByRole("button", { name: "Use Leica guidance" }).click();
  await expect(page.getByRole("alert")).toContainText("The Leica guide could not load");
  await expect(page.getByRole("heading", { name: "Watch the work. Review the details." })).toBeVisible();
  unavailable = false;
  await page.getByRole("button", { name: "Retry Leica guidance" }).click();
  await expect(page.getByRole("heading", { name: "Leica M10 assembly", exact: true })).toBeVisible();
});

test("entering a Leica guide-only study clears an earlier uploaded video before applying the guide", async ({ page }) => {
  const operations: string[] = [];
  page.on("request", request => {
    if (request.method() === "POST" && /\/api\/(source|reference\/upload)$/.test(new URL(request.url()).pathname))
      operations.push(new URL(request.url()).pathname);
  });
  await page.goto("/");
  const previousSource = await page.evaluate(async () => {
    const headers = { "X-Guidance-Session": sessionStorage.getItem("process-guide-session")!, "Content-Type": "application/json" };
    await fetch("/api/source", { method: "POST", headers, body: JSON.stringify({ source_id: "earlier-recording", kind: "video", name: "Earlier uploaded process" }) });
    // Load actual bundled bytes on the server to exercise its video fallback.
    const catalog = await (await fetch("/api/samples", { headers })).json();
    const selected = catalog.videos?.[0] || catalog.samples?.[0];
    if (!selected) throw new Error("Missing sample video fixture");
    const response = await fetch("/api/video/load-sample", {
      method: "POST", headers,
      body: JSON.stringify({ id: selected.id, source_id: "earlier-recording" }),
    });
    if (!response.ok) throw new Error("Earlier recording fixture could not load");
    return response.json();
  });
  expect(previousSource.stream_url).toBeTruthy();
  await page.reload();
  await expect(page.getByText(previousSource.video_name, { exact: false }).first()).toBeVisible();
  operations.length = 0;
  await page.getByRole("button", { name: "Use Leica guidance" }).click();
  await expect(page.getByRole("heading", { name: "Leica M10 assembly", exact: true })).toBeVisible();
  expect(operations.slice(0, 2)).toEqual(["/api/source", "/api/reference/upload"]);
  const session = await page.evaluate(async () => (await fetch("/api/session", {
    headers: { "X-Guidance-Session": sessionStorage.getItem("process-guide-session")! },
  })).json());
  expect(session.video).toBeFalsy();
  expect(session.source_name).toBe("Leica M10 guide — no shared input");
  let question: Record<string, unknown> | undefined;
  await page.route("**/api/llm/ask/stream", route => {
    question = route.request().postDataJSON();
    return route.fulfill({ contentType: "text/event-stream", body: 'data: {"delta":"Reference guidance only; no visual source is shared."}\n\ndata: {"done":true,"used_frames":0}\n\n' });
  });
  await page.getByRole("button", { name: "Open chat", exact: true }).click();
  await page.getByRole("textbox", { name: "Message", exact: true }).fill("According to the reference guide, what can I check when the operator closes the camera body?");
  await page.getByRole("button", { name: "Send message", exact: true }).click();
  await expect.poll(() => question).toBeDefined();
  expect(question!.frames_b64).toEqual([]);
  expect(question!.frame_times_s).toEqual([]);
});

for (const width of [320, 768, 1440]) {
  test(`Leica workspace at ${width}px keeps guide, voice and source controls accessible at 200% text`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/");
    await page.getByRole("button", { name: "Use Leica guidance", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Leica M10 assembly", exact: true })).toBeVisible();
    await page.evaluate(() => { document.documentElement.style.fontSize = "32px"; });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const study = page.getByRole("region", { name: "Leica M10 assembly", exact: true });
    expect(await study.evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
    await expect(page.getByRole("button", { name: "Share authorized footage", exact: true })).toBeEnabled();
    await expect(page.getByRole("button", { name: "Hear study instructions", exact: true })).toBeEnabled();
    await expect(page.getByRole("button", { name: "Open chat", exact: true })).toBeVisible();
  });
}
