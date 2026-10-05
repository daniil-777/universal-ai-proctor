import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { execFileSync } from "node:child_process";

// Prerequisites: Node 24, repository backend/frontend dependencies, installed
// Chrome + Playwright WebKit, ffprobe, and the compiled app running on 8101.
// Fresh contexts only; API writes are blocked, and no account/camera/upload/AI
// actions are performed. Browser and context resources close in finally.
// Run from guidance-app with the command shown by --help. Optional diagnostics:
// --profile=desktop, --profile=phone, or --profile=tablet overwrite the evidence
// with that single requested profile; run without the flag for the full result.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
if (process.argv.includes("--help")) {
  console.log("From guidance-app: node --import ./backend/node_modules/tsx/dist/loader.mjs scripts/walkthrough-smoke.mts");
  console.log("Checks the running local production app on 8101; writes docs/walkthrough-production-smoke.json and walkthrough-production-* screenshots.");
  process.exit(0);
}
const { chromium, webkit, expect } = await import(pathToFileURL(path.join(root, "frontend/node_modules/@playwright/test/index.mjs")).href);
const origin = "http://localhost:8101";
const mediaPath = "/media/process-guide-walkthrough";
const destination = path.join(root, "docs/walkthrough-production-smoke.json");
const screenshotRoot = path.join(root, "docs/screenshots");
const profiles = [
  { name: "desktop", engine: "chrome", width: 1440, height: 1000 },
  { name: "phone", engine: "chrome", width: 390, height: 844 },
  { name: "tablet", engine: "webkit", width: 820, height: 1180 },
];
const requestedProfile = process.argv.find(argument => argument.startsWith("--profile="))?.split("=")[1];
const evidence: any = {
  date: new Date().toISOString(),
  app_url: origin,
  completed: false,
  profiles: [],
  caveats: [
    "Chrome and WebKit profiles emulate viewport and touch behavior; they do not replace physical-device, mobile-network, on-screen-keyboard or hardware-audio testing.",
    "Timings are local-machine observations with fresh browser contexts, not cloud or cellular performance guarantees.",
    "Unmuted playback, volume, audio codec and actual video decoding are checked; headless execution does not establish subjective narration quality or audible speaker output.",
    "English VTT loading is checked by enabling its text track after recording the default-off state; the authored video already contains burned captions.",
    "Scrolling the video completely offscreen releases its source. Chapter resume therefore requires a new explicit Play.",
    "At 820×1180, maximum transcript scrolling can leave some video visible. The tablet offscreen-release check temporarily uses 820×700, then restores the original viewport for chapter and layout verification.",
    "A detached video can retain its last currentSrc diagnostic URL. Close is verified through removed src, paused media, readyState 0/networkState 0, no buffered ranges, stable time and restored focus.",
  ],
};

function timestamp(seconds: number) {
  return Math.floor(seconds / 60) + ":" + String(Math.floor(seconds % 60)).padStart(2, "0");
}
function isWalkthroughRequest(url: string) {
  return url.includes(mediaPath + ".mp4") || url.includes(mediaPath + ".json") || /\/assets\/WalkthroughDialog-[^/]+\.js/.test(url);
}
async function layout(page: any) {
  return page.evaluate(() => {
    const dialog = document.querySelector(".workspace-walkthrough-dialog") as HTMLElement | null;
    const close = dialog?.querySelector(".dialog-close")?.getBoundingClientRect();
    return {
      page_overflow: document.documentElement.scrollWidth > innerWidth + 1,
      dialog_overflow: !!dialog && dialog.scrollWidth > dialog.clientWidth + 1,
      close_visible: !!close && close.top >= 0 && close.bottom <= innerHeight && close.left >= 0 && close.right <= innerWidth,
      clipped_buttons: dialog ? Array.from(dialog.querySelectorAll("button")).filter(button => button.getBoundingClientRect().width > 0 && button.scrollWidth > button.clientWidth + 1).map(button => button.textContent?.trim()) : [],
    };
  });
}
async function screenshot(page: any, name: string) {
  await page.waitForTimeout(300);
  const result = await layout(page);
  await page.screenshot({ path: path.join(screenshotRoot, "walkthrough-production-" + name + ".png") });
  expect(result.page_overflow).toBe(false);
  expect(result.dialog_overflow).toBe(false);
  expect(result.close_visible).toBe(true);
  expect(result.clipped_buttons).toEqual([]);
  return result;
}
async function mediaState(video: any) {
  return video.evaluate((element: HTMLVideoElement) => ({
    duration: element.duration,
    current_time: element.currentTime,
    paused: element.paused,
    muted: element.muted,
    volume: element.volume,
    inline: element.playsInline,
    controls: element.controls,
    ready_state: element.readyState,
    width: element.videoWidth,
    height: element.videoHeight,
    has_src: element.hasAttribute("src"),
  }));
}
async function decodedFrame(video: any) {
  return video.evaluate((element: HTMLVideoElement) => {
    const canvas = document.createElement("canvas");
    canvas.width = 64; canvas.height = 36;
    const context = canvas.getContext("2d")!;
    context.drawImage(element, 0, 0, canvas.width, canvas.height);
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    let minimum = 255, maximum = 0, energy = 0;
    for (let index = 0; index < pixels.length; index += 4) {
      const light = (pixels[index] + pixels[index + 1] + pixels[index + 2]) / 3;
      minimum = Math.min(minimum, light); maximum = Math.max(maximum, light); energy += light;
    }
    return {
      minimum, maximum, mean: energy / (canvas.width * canvas.height),
      decoded_frames: (element as HTMLVideoElement & { webkitDecodedFrameCount?: number }).webkitDecodedFrameCount ?? null,
    };
  });
}

let browser: any;
try {
  if (requestedProfile && !profiles.some(profile => profile.name === requestedProfile)) throw new Error("Unknown profile; choose desktop, phone or tablet.");
  await fs.mkdir(screenshotRoot, { recursive: true });
  const probe = JSON.parse(execFileSync("ffprobe", ["-v", "error", "-show_streams", "-show_format", "-of", "json", path.join(root, "frontend/dist/media/process-guide-walkthrough.mp4")], { encoding: "utf8" }));
  const visual = probe.streams.find((stream: any) => stream.codec_type === "video");
  const audio = probe.streams.find((stream: any) => stream.codec_type === "audio");
  expect(visual?.codec_name).toBe("h264");
  expect(audio?.codec_name).toBe("aac");
  const [numerator, denominator] = String(visual.r_frame_rate).split("/").map(Number);
  const frameSeconds = denominator / numerator;
  expect(frameSeconds).toBeGreaterThan(0);
  expect(Math.abs(Number(probe.format.duration) - 90)).toBeLessThanOrEqual(frameSeconds + 0.005);
  evidence.asset = {
    video_codec: visual.codec_name, audio_codec: audio.codec_name,
    pixel_format: visual.pix_fmt, width: visual.width, height: visual.height,
    frame_rate: visual.r_frame_rate, duration_s: Number(probe.format.duration),
    bytes: Number(probe.format.size),
  };
  const metadataOnDisk = JSON.parse(await fs.readFile(path.join(root, "frontend/dist/media/process-guide-walkthrough.json"), "utf8"));
  expect(metadataOnDisk.duration_s).toBe(90);
  expect(metadataOnDisk.language).toBe("en");
  expect(metadataOnDisk.captions_burned_in).toBe(true);

  const selectedProfiles = profiles.filter(profile => !requestedProfile || profile.name === requestedProfile);
  evidence.requested_profiles = selectedProfiles.map(profile => profile.name);
  for (const profile of selectedProfiles) {
    console.log("Walkthrough production smoke: " + profile.name);
    browser = profile.engine === "chrome" ? await chromium.launch({ channel: "chrome", headless: true }) : await webkit.launch({ headless: true });
    const context = await browser.newContext({
      viewport: { width: profile.width, height: profile.height },
      isMobile: profile.width < 500, hasTouch: profile.engine === "webkit" || profile.width < 500,
      colorScheme: "light",
    });
    const page = await context.newPage();
    page.setDefaultTimeout(15000);
    const requests: string[] = [], errors: string[] = [], prohibited: string[] = [], external: string[] = [];
    const result: any = { name: profile.name, engine: profile.engine, width: profile.width, height: profile.height, errors, prohibited_requests: prohibited, external_requests: external };
    evidence.profiles.push(result);
    page.on("pageerror", (error: Error) => errors.push(error.message));
    page.on("request", (request: any) => {
      requests.push(request.url());
      if (/^https?:/.test(request.url()) && new URL(request.url()).origin !== origin) external.push(request.url());
    });
    await page.route("**/api/**", async (route: any) => {
      const request = route.request();
      if (!["GET", "HEAD", "OPTIONS"].includes(request.method())) {
        prohibited.push(request.method() + " " + new URL(request.url()).pathname);
        await route.abort("blockedbyclient");
      } else await route.continue();
    });
    const introStart = performance.now();
    await page.goto(origin);
    const launcher = page.getByRole("button", { name: "See full walkthrough", exact: true });
    await expect(launcher).toBeVisible();
    await page.waitForTimeout(400);
    result.intro_ready_ms = Math.round(performance.now() - introStart);
    result.initial_walkthrough_requests = requests.filter(isWalkthroughRequest);
    expect(result.initial_walkthrough_requests).toEqual([]);
    const metadataResponse = page.waitForResponse((response: any) => new URL(response.url()).pathname === mediaPath + ".json" && response.ok());
    const openStart = performance.now();
    await launcher.click();
    const metadata = await (await metadataResponse).json();
    expect(metadata).toEqual(metadataOnDisk);
    const dialog = page.getByRole("dialog", { name: "Process Guide walkthrough", exact: true });
    await expect(dialog).toBeVisible();
    const video = page.getByTestId("walkthrough-video");
    await expect(video).toBeVisible();
    expect(await video.getAttribute("src")).toBeNull();
    expect(await video.getAttribute("preload")).toBe("none");
    result.open_ready_ms = Math.round(performance.now() - openStart);
    result.open_mp4_requests = requests.filter(url => url.includes(mediaPath + ".mp4"));
    expect(result.open_mp4_requests).toEqual([]);
    result.metadata = { title: metadata.title, duration_s: metadata.duration_s, language: metadata.language, captions_burned_in: metadata.captions_burned_in, chapters: metadata.chapters.length, transcript_lines: metadata.transcript.length };
    result.open_layout = await screenshot(page, profile.name + "-open");

    const earlyChapter = metadata.chapters.find((chapter: any) => chapter.start_s > 0);
    expect(earlyChapter).toBeTruthy();
    await dialog.getByRole("button", { name: timestamp(earlyChapter.start_s) + " " + earlyChapter.title, exact: true }).click();
    expect(await video.getAttribute("src")).toBeNull();
    expect(requests.filter(url => url.includes(mediaPath + ".mp4"))).toEqual([]);
    await video.scrollIntoViewIfNeeded();
    const firstResponse = page.waitForResponse((response: any) => new URL(response.url()).pathname === mediaPath + ".mp4" && response.ok());
    const playStart = performance.now();
    await dialog.getByRole("button", { name: "Play narrated walkthrough", exact: true }).click();
    const response = await firstResponse;
    result.first_media_status = response.status();
    result.first_media_content_range = await response.headerValue("content-range");
    await expect.poll(async () => {
      const state = await mediaState(video);
      return state.ready_state >= 2 && !state.paused && state.current_time > earlyChapter.start_s + 0.1;
    }).toBe(true);
    result.play_ready_ms = Math.round(performance.now() - playStart);
    result.playback = await mediaState(video);
    expect(Math.abs(result.playback.duration - 90)).toBeLessThanOrEqual(frameSeconds + 0.005);
    expect(result.playback.muted).toBe(false);
    expect(result.playback.volume).toBeGreaterThan(0);
    expect(result.playback.inline).toBe(true);
    expect(result.playback.controls).toBe(true);
    expect(result.playback.width).toBe(visual.width);
    expect(result.playback.height).toBe(visual.height);
    result.decoded_frame = await decodedFrame(video);
    expect(result.decoded_frame.maximum - result.decoded_frame.minimum).toBeGreaterThan(10);
    result.play_layout = await screenshot(page, profile.name + "-playing");

    await dialog.getByRole("button", { name: "Pause narrated walkthrough", exact: true }).click();
    await expect.poll(async () => (await mediaState(video)).paused).toBe(true);
    const track = video.locator("track");
    await expect(track).toHaveAttribute("label", "English");
    await expect(track).toHaveAttribute("srclang", "en");
    expect(await track.getAttribute("default")).toBeNull();
    result.caption_default = await track.evaluate((element: HTMLTrackElement) => ({ default: element.default, mode: element.track.mode }));
    expect(result.caption_default.mode).toBe("disabled");
    await track.evaluate((element: HTMLTrackElement) => { element.track.mode = "hidden"; });
    await expect.poll(() => track.evaluate((element: HTMLTrackElement) => element.readyState)).toBe(2);
    result.captions = await track.evaluate((element: HTMLTrackElement) => ({
      ready_state: element.readyState, label: element.label, language: element.srclang,
      cues: element.track.cues?.length ?? 0,
      first_cue: (element.track.cues?.[0] as VTTCue | undefined)?.text ?? "",
    }));
    expect(result.captions.cues).toBeGreaterThan(0);
    await track.evaluate((element: HTMLTrackElement) => { element.track.mode = "disabled"; });

    // A real scroll clips the video and lets IntersectionObserver release its source.
    await dialog.getByText("Transcript and written guide", { exact: true }).click();
    await dialog.locator("details p").last().scrollIntoViewIfNeeded();
    result.release_geometry = await video.evaluate((element: HTMLVideoElement) => {
      const videoRect = element.getBoundingClientRect();
      const body = element.parentElement!.parentElement!;
      const bodyRect = body.getBoundingClientRect();
      return {
        video_top: videoRect.top, video_bottom: videoRect.bottom,
        body_top: bodyRect.top, body_bottom: bodyRect.bottom,
        scroll_top: body.scrollTop, scroll_height: body.scrollHeight,
        visible_height: Math.max(0, Math.min(videoRect.bottom, bodyRect.bottom, innerHeight) - Math.max(videoRect.top, bodyRect.top, 0)),
      };
    });
    console.log("Release geometry: " + JSON.stringify(result.release_geometry));
    if (result.release_geometry.visible_height > 0) {
      // A tall tablet can keep the video partly visible even at maximum scroll.
      // A real viewport resize exercises release without mocking its observer.
      result.release_viewport = { width: profile.width, height: 700 };
      await page.setViewportSize(result.release_viewport);
      await dialog.locator("details p").last().scrollIntoViewIfNeeded();
      result.release_geometry_after_resize = await video.evaluate((element: HTMLVideoElement) => {
        const videoRect = element.getBoundingClientRect();
        const bodyRect = element.parentElement!.parentElement!.getBoundingClientRect();
        return { visible_height: Math.max(0, Math.min(videoRect.bottom, bodyRect.bottom, innerHeight) - Math.max(videoRect.top, bodyRect.top, 0)) };
      });
      expect(result.release_geometry_after_resize.visible_height).toBe(0);
    }
    await expect.poll(() => video.getAttribute("src")).toBeNull();
    result.offscreen_release = await mediaState(video);
    expect(result.offscreen_release.paused).toBe(true);
    if (result.release_viewport) await page.setViewportSize({ width: profile.width, height: profile.height });
    const lateChapter = metadata.chapters.at(-1);
    await dialog.getByRole("button", { name: timestamp(lateChapter.start_s) + " " + lateChapter.title, exact: true }).click();
    expect(await video.getAttribute("src")).toBeNull();
    await video.scrollIntoViewIfNeeded();
    await page.waitForTimeout(150);
    expect(await video.getAttribute("src")).toBeNull();
    await dialog.getByRole("button", { name: "Play narrated walkthrough", exact: true }).click();
    await expect.poll(async () => {
      const state = await mediaState(video);
      return state.ready_state >= 2 && !state.paused && state.current_time >= lateChapter.start_s;
    }).toBe(true);
    result.chapter_resume = { authored_start_s: lateChapter.start_s, media: await mediaState(video), decoded: await decodedFrame(video), explicit_play_required: true };
    expect(result.chapter_resume.decoded.maximum - result.chapter_resume.decoded.minimum).toBeGreaterThan(10);
    result.chapter_layout = await screenshot(page, profile.name + "-chapter");

    const retainedVideo = await video.elementHandle();
    await dialog.getByRole("button", { name: "Close", exact: true }).click();
    await expect(video).toHaveCount(0);
    await expect(launcher).toBeFocused();
    result.close = await retainedVideo.evaluate((element: HTMLVideoElement) => ({
      src_removed: !element.hasAttribute("src"), paused: element.paused,
      current_src: element.currentSrc, ready_state: element.readyState,
      network_state: element.networkState, buffered_ranges: element.buffered.length,
      connected: element.isConnected, current_time: element.currentTime,
    }));
    console.log("Closed media state: " + JSON.stringify(result.close));
    expect(result.close.src_removed).toBe(true);
    expect(result.close.paused).toBe(true);
    expect(result.close.ready_state).toBe(0);
    expect([0, 3]).toContain(result.close.network_state);
    expect(result.close.buffered_ranges).toBe(0);
    expect(result.close.connected).toBe(false);
    await page.waitForTimeout(500);
    result.close_after_500ms = await retainedVideo.evaluate((element: HTMLVideoElement) => ({ current_time: element.currentTime, ready_state: element.readyState, network_state: element.networkState, paused: element.paused }));
    expect(result.close_after_500ms.current_time).toBe(result.close.current_time);
    expect(result.close_after_500ms.paused).toBe(true);
    await retainedVideo.dispose();
    result.launcher_focus_restored = true;

    if (profile.name === "phone") {
      await page.getByRole("button", { name: "Open workspace", exact: true }).click();
      await page.getByRole("button", { name: "Settings", exact: true }).click();
      const settings = page.getByRole("dialog", { name: "Workspace settings", exact: true });
      const settingsLauncher = settings.getByRole("button", { name: "See full walkthrough", exact: true });
      await settingsLauncher.click();
      const settingsVideo = page.getByTestId("walkthrough-video");
      await expect(settingsVideo).toBeVisible();
      expect(await settingsVideo.getAttribute("src")).toBeNull();
      result.settings_layout = await screenshot(page, profile.name + "-settings-launcher");
      await page.getByRole("dialog", { name: "Process Guide walkthrough", exact: true }).getByRole("button", { name: "Close", exact: true }).click();
      await expect(settingsLauncher).toBeFocused();
      result.phone_settings_access = true;
      await settings.getByRole("button", { name: "Close", exact: true }).click();
    }
    result.walkthrough_mp4_requests = requests.filter(url => url.includes(mediaPath + ".mp4")).length;
    expect(errors).toEqual([]);
    expect(prohibited).toEqual([]);
    expect(external).toEqual([]);
    await context.close();
    await browser.close();
    browser = undefined;
  }

  const ranged = await fetch(origin + mediaPath + ".mp4", { headers: { Range: "bytes=0-1023" } });
  const bytes = await ranged.arrayBuffer();
  evidence.range = { status: ranged.status, content_range: ranged.headers.get("content-range"), content_type: ranged.headers.get("content-type"), bytes: bytes.byteLength };
  expect(ranged.status).toBe(206);
  expect(bytes.byteLength).toBe(1024);
  expect(evidence.range.content_range).toMatch(/^bytes 0-1023\/\d+$/);
  evidence.completed = true;
  evidence.actual_provider_calls = 0;
  console.log(JSON.stringify({ completed: true, profiles: evidence.profiles.map((profile: any) => ({ name: profile.name, duration: profile.playback.duration, initial_requests: profile.initial_walkthrough_requests.length, captions: profile.captions.cues, errors: profile.errors.length })), range: evidence.range }, null, 2));
} catch (error) {
  evidence.failure = error instanceof Error ? error.message : String(error);
  throw error;
} finally {
  if (browser) await browser.close();
  await fs.writeFile(destination, JSON.stringify(evidence, null, 2) + "\n");
}
