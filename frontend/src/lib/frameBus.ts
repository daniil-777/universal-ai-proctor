export interface FrameGrab {
  b64: string | null;
  currentS: number;
  durationS: number;
  paused?: boolean;
}
let accessor: (() => FrameGrab) | null = null;
export function setVideoAccessor(fn: (() => FrameGrab) | null) {
  accessor = fn;
}
export function grabFrame(): FrameGrab {
  return accessor
    ? accessor()
    : { b64: null, currentS: 0, durationS: 0, paused: true };
}
const buffered: Array<{ b64: string; currentS: number }> = [];
const MAX_BUFFERED_FRAMES = 64;
const MAX_BUFFER_AGE_S = 30;
// Base64 remains a JavaScript string: this bounds retained image data to about
// 16 MiB even on cameras that produce unusually large JPEGs.
const MAX_BUFFERED_CHARACTERS = 8 * 1024 * 1024;
let bufferedCharacters = 0;
export function clearFrames() {
  buffered.length = 0;
  bufferedCharacters = 0;
}
export function bufferFrame(frame: FrameGrab) {
  if (!frame.b64 || frame.b64.length > MAX_BUFFERED_CHARACTERS || !Number.isFinite(frame.currentS)) return;
  let previous = buffered.at(-1);
  if (previous && frame.currentS < previous.currentS - 0.05) {
    clearFrames();
    previous = undefined;
  }
  if (previous && (
    Math.abs(previous.currentS - frame.currentS) < 0.15 ||
    previous.b64 === frame.b64
  )) {
    bufferedCharacters -= previous.b64.length;
    buffered[buffered.length - 1] = {
      b64: frame.b64,
      currentS: frame.currentS,
    };
  } else {
    buffered.push({ b64: frame.b64, currentS: frame.currentS });
  }
  bufferedCharacters += frame.b64.length;
  const remove = (index: number) => {
    bufferedCharacters -= buffered[index]!.b64.length;
    buffered.splice(index, 1);
  };
  while (buffered.length > 1 && frame.currentS - buffered[0]!.currentS > MAX_BUFFER_AGE_S)
    remove(0);
  while (buffered.length > MAX_BUFFERED_FRAMES) {
    // Keep the newest eight seconds dense at 4 Hz. Thin older context where
    // adjacent samples are closest, preserving coverage during slow inference.
    let selected = 1;
    let smallestSpan = Infinity;
    for (let i = 1; i < buffered.length - 32; i++) {
      const span = buffered[i + 1]!.currentS - buffered[i - 1]!.currentS;
      if (span < smallestSpan) { selected = i; smallestSpan = span; }
    }
    remove(selected);
  }
  while (buffered.length > 1 && bufferedCharacters > MAX_BUFFERED_CHARACTERS)
    remove(0);
}
export function recentFrameSamples(
  windowSecs = 5,
  count = 4,
  recentMotion = false,
): Array<{ b64: string; currentS: number }> {
  const last = buffered.at(-1);
  if (!last) return [];
  const limit = Math.max(1, Math.min(32, Math.floor(count)));
  if (limit <= 1) return [last];
  const window = buffered.filter(
    (f) =>
      last.currentS - f.currentS >= 0 &&
      last.currentS - f.currentS <= windowSecs,
  );
  // Keep the latest timestamp for each EXACT repeated image. This reduces image
  // tokens without hiding small visual changes or reusing old completion votes.
  const seen = new Set<string>();
  const within = window.slice().reverse().filter(f => {
    if (seen.has(f.b64)) return false;
    seen.add(f.b64); return true;
  }).reverse();
  const evenly = (frames: typeof within, amount: number) =>
    amount === 1
      ? [frames[frames.length - 1]!]
      : frames.length <= amount
      ? frames
      : Array.from(
          { length: amount },
          (_, i) => frames[Math.round((i * (frames.length - 1)) / (amount - 1))]!,
        );
  if (recentMotion) {
    const recent = within.filter((f) => last.currentS - f.currentS <= 1);
    const older = within.filter((f) => last.currentS - f.currentS > 1);
    const recentCount = Math.min(3, limit - 1);
    // Keep one context image while giving brief movements several current
    // views. Sparse buffers retain the established evenly spaced selection.
    if (older.length && recent.length >= recentCount) {
      const contextCount = limit - recentCount;
      const context = contextCount === 1 ? [older[0]!] : evenly(older, contextCount);
      return [...context, ...evenly(recent, recentCount)];
    }
  }
  return evenly(within, limit);
}
export function recentFrames(windowSecs = 5, count = 4): string[] {
  return recentFrameSamples(windowSecs, count).map((f) => f.b64);
}
export async function sampleVideoOverview(
  url: string,
  count = 5,
  onSampleTimes?: (times: number[]) => void,
  signal?: AbortSignal,
): Promise<string[]> {
  const video = document.createElement("video");
  video.preload = "auto";
  video.muted = true;
  video.crossOrigin = "anonymous";
  const wait = (event: string) =>
    new Promise<void>((resolve, reject) => {
      if (signal?.aborted) { reject(new DOMException("Canceled", "AbortError")); return; }
      const timer = setTimeout(() => {
        cleanup();
        reject(new Error("Video preview timed out"));
      }, 8000);
      const success = () => {
        cleanup();
        resolve();
      };
      const fail = () => {
        cleanup();
        reject(new Error("Video preview unavailable"));
      };
      const abort = () => { cleanup(); reject(new DOMException("Canceled", "AbortError")); };
      const cleanup = () => {
        clearTimeout(timer);
        video.removeEventListener(event, success);
        video.removeEventListener("error", fail);
        signal?.removeEventListener("abort", abort);
      };
      signal?.addEventListener("abort", abort, { once: true });
      video.addEventListener(event, success, { once: true });
      video.addEventListener("error", fail, { once: true });
    });
  try {
    const loaded = wait("loadedmetadata");
    video.src = url;
    await loaded;
    if (!Number.isFinite(video.duration) || !video.duration) return [];
    const canvas = document.createElement("canvas");
    const scale = Math.min(
      1,
      640 / Math.max(video.videoWidth, video.videoHeight),
    );
    canvas.width = Math.max(1, Math.round(video.videoWidth * scale));
    canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
    const context = canvas.getContext("2d");
    if (!context) return [];
    const result: string[] = [];
    const times: number[] = [];
    for (let i = 0; i < count; i++) {
      const seek = wait("seeked");
      video.currentTime = Math.min(
        video.duration - 0.01,
        video.duration * (0.02 + (0.93 * i) / Math.max(1, count - 1)),
      );
      await seek;
      times.push(video.currentTime);
      context.drawImage(video, 0, 0, canvas.width, canvas.height);
      result.push(canvas.toDataURL("image/jpeg", 0.7).split(",")[1]!);
    }
    onSampleTimes?.(times);
    return result;
  } finally {
    video.pause();
    video.removeAttribute("src");
    video.load();
  }
}
