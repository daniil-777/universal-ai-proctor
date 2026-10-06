import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WalkthroughLauncher } from "../WalkthroughLauncher";

const guide = {
  title: "Cueveris app walkthrough",
  duration_s: 90,
  language: "en",
  captions_burned_in: true,
  chapters: [
    { id: "setup", title: "Choose a source", start_s: 0, end_s: 12.5 },
    { id: "evidence", title: "Review the evidence", start_s: 12.5, end_s: 90 },
  ],
  transcript: [
    {
      start_s: 0,
      end_s: 12.5,
      text: "Choose a source using the app controls.",
    },
    {
      start_s: 12.5,
      end_s: 90,
      text: "Review recorded evidence before confirming process progress.",
    },
  ],
};
let fetchMock: ReturnType<typeof vi.fn>;
let observerCallback: IntersectionObserverCallback;
let hidden: ReturnType<typeof vi.spyOn>;
let scrollIntoView: ReturnType<typeof vi.fn>;
const originalScrollIntoView = Object.getOwnPropertyDescriptor(
  HTMLElement.prototype,
  "scrollIntoView",
);

beforeEach(() => {
  // jsdom does not implement scrolling; browser tests exercise real clipping.
  scrollIntoView = vi.fn();
  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
    configurable: true,
    value: scrollIntoView,
  });
  fetchMock = vi.fn(
    async () =>
      new Response(JSON.stringify(guide), {
        headers: { "Content-Type": "application/json" },
      }),
  );
  vi.stubGlobal("fetch", fetchMock);
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      constructor(callback: IntersectionObserverCallback) {
        observerCallback = callback;
      }
      observe() {}
      disconnect() {}
    },
  );
  vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
  vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(() => {});
  hidden = vi.spyOn(document, "hidden", "get").mockReturnValue(false);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  if (originalScrollIntoView)
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", originalScrollIntoView);
  else Reflect.deleteProperty(HTMLElement.prototype, "scrollIntoView");
});

async function openGuide() {
  fireEvent.click(screen.getByRole("button", { name: "See full walkthrough" }));
  await screen.findByRole("heading", { name: "Cueveris walkthrough" });
  await screen.findByRole("button", { name: "0:12 Review the evidence" });
  return screen.getByTestId("walkthrough-video") as HTMLVideoElement;
}
function loaded(video: HTMLVideoElement) {
  Object.defineProperty(video, "duration", { configurable: true, value: 90 });
  Object.defineProperty(video, "readyState", { configurable: true, value: 1 });
  fireEvent.loadedMetadata(video);
}

describe("narrated app walkthrough", () => {
  it("loads the dialog and metadata only when requested, and never starts video on open", async () => {
    render(<WalkthroughLauncher />);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.queryByTestId("walkthrough-video")).toBeNull();
    const video = await openGuide();
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls[0][0]).toBe(
      "/media/process-guide-walkthrough.json",
    );
    expect(video).not.toHaveAttribute("src");
    expect(video.preload).toBe("none");
    expect(HTMLMediaElement.prototype.play).not.toHaveBeenCalled();
  });

  it("starts audible inline playback with native controls and English captions after Play", async () => {
    render(<WalkthroughLauncher />);
    const video = await openGuide();
    fireEvent.click(
      screen.getByRole("button", { name: "Play narrated walkthrough" }),
    );
    expect(video).toHaveAttribute(
      "src",
      "/media/process-guide-walkthrough.mp4",
    );
    expect(video.muted).toBe(false);
    expect(video.playsInline).toBe(true);
    expect(video.controls).toBe(true);
    expect(HTMLMediaElement.prototype.play).toHaveBeenCalledOnce();
    expect(video.querySelector("track")).toHaveAttribute(
      "src",
      "/media/process-guide-walkthrough.vtt",
    );
    expect(video.querySelector("track")).toHaveAttribute("label", "English");
    expect(video.querySelector("track")).not.toHaveAttribute("default");
    fireEvent.play(video);
    fireEvent.click(
      screen.getByRole("button", { name: "Pause narrated walkthrough" }),
    );
    expect(HTMLMediaElement.prototype.pause).toHaveBeenCalled();
    expect(
      fetchMock.mock.calls.every(([url]) => String(url).startsWith("/media/")),
    ).toBe(true);
  });

  it("reveals the actual player before loading its source or starting audible playback", async () => {
    render(<WalkthroughLauncher />);
    const video = await openGuide();
    scrollIntoView.mockImplementation(function (this: HTMLElement) {
      if (this !== video) return;
      expect(video).not.toHaveAttribute("src");
      expect(HTMLMediaElement.prototype.play).not.toHaveBeenCalled();
    });
    fireEvent.click(screen.getByRole("button", { name: "Play narrated walkthrough" }));
    const reveal = scrollIntoView.mock.contexts.findIndex(context => context === video);
    expect(reveal).toBeGreaterThanOrEqual(0);
    expect(scrollIntoView.mock.calls[reveal]).toEqual([{ block: "nearest", inline: "nearest" }]);
    expect(scrollIntoView.mock.invocationCallOrder[reveal]).toBeLessThan(
      vi.mocked(HTMLMediaElement.prototype.play).mock.invocationCallOrder[0]!,
    );
    expect(HTMLMediaElement.prototype.play).toHaveBeenCalledOnce();
    expect(video.muted).toBe(false);
  });

  it("uses authored chapter timings without loading media or playing when a chapter is selected", async () => {
    render(<WalkthroughLauncher />);
    const video = await openGuide();
    fireEvent.click(
      screen.getByRole("button", { name: "0:12 Review the evidence" }),
    );
    expect(video).not.toHaveAttribute("src");
    expect(HTMLMediaElement.prototype.play).not.toHaveBeenCalled();
    expect(
      screen.getByRole("button", { name: "0:12 Review the evidence" }),
    ).toHaveAttribute("aria-current", "step");
    fireEvent.click(
      screen.getByRole("button", { name: "Play narrated walkthrough" }),
    );
    loaded(video);
    expect(video.currentTime).toBe(12.5);
    fireEvent.click(
      screen.getByRole("button", { name: "0:00 Choose a source" }),
    );
    expect(video.currentTime).toBe(0);
    expect(HTMLMediaElement.prototype.play).toHaveBeenCalledOnce();
  });

  it("pauses, releases the media source and cancels metadata work when closed", async () => {
    render(<WalkthroughLauncher />);
    const video = await openGuide();
    fireEvent.click(
      screen.getByRole("button", { name: "Play narrated walkthrough" }),
    );
    const signal = fetchMock.mock.calls[0][1].signal as AbortSignal;
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.queryByTestId("walkthrough-video")).toBeNull();
    expect(video).not.toHaveAttribute("src");
    expect(signal.aborted).toBe(true);
    expect(HTMLMediaElement.prototype.pause).toHaveBeenCalled();
    expect(HTMLMediaElement.prototype.load).toHaveBeenCalled();
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "See full walkthrough" }),
      ).toHaveFocus(),
    );
  });

  it.each(["hidden", "offscreen"])(
    "releases playback when %s and resumes only after an explicit new Play",
    async (reason) => {
      render(<WalkthroughLauncher />);
      const video = await openGuide();
      fireEvent.click(
        screen.getByRole("button", { name: "Play narrated walkthrough" }),
      );
      loaded(video);
      video.currentTime = 17;
      fireEvent.timeUpdate(video);
      await act(async () => {
        if (reason === "hidden") {
          hidden.mockReturnValue(true);
          document.dispatchEvent(new Event("visibilitychange"));
        } else
          observerCallback(
            [{ isIntersecting: false } as IntersectionObserverEntry],
            {} as IntersectionObserver,
          );
      });
      expect(video).not.toHaveAttribute("src");
      await act(async () => {
        hidden.mockReturnValue(false);
        document.dispatchEvent(new Event("visibilitychange"));
        observerCallback(
          [{ isIntersecting: true } as IntersectionObserverEntry],
          {} as IntersectionObserver,
        );
      });
      expect(video).not.toHaveAttribute("src");
      expect(HTMLMediaElement.prototype.play).toHaveBeenCalledOnce();
      fireEvent.click(
        screen.getByRole("button", { name: "Play narrated walkthrough" }),
      );
      loaded(video);
      expect(video.currentTime).toBe(17);
      expect(HTMLMediaElement.prototype.play).toHaveBeenCalledTimes(2);
    },
  );

  it("keeps the real transcript available after a media failure and retries only on request", async () => {
    render(<WalkthroughLauncher />);
    const video = await openGuide();
    fireEvent.click(
      screen.getByRole("button", { name: "Play narrated walkthrough" }),
    );
    fireEvent.error(video);
    expect(screen.getByRole("alert")).toHaveTextContent(
      "The walkthrough could not play",
    );
    expect(video).not.toHaveAttribute("src");
    fireEvent.click(screen.getByRole("button", { name: "Read transcript" }));
    expect(screen.getByText(guide.transcript[1].text)).toBeVisible();
    expect(HTMLMediaElement.prototype.play).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole("button", { name: "Retry walkthrough" }));
    expect(video).toHaveAttribute(
      "src",
      "/media/process-guide-walkthrough.mp4",
    );
    expect(HTMLMediaElement.prototype.play).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("ignores a delayed playback rejection from a closed dialog", async () => {
    let reject!: (error: Error) => void;
    vi.mocked(HTMLMediaElement.prototype.play).mockReturnValueOnce(
      new Promise((_resolve, fail) => {
        reject = fail;
      }),
    );
    render(<WalkthroughLauncher />);
    await openGuide();
    fireEvent.click(
      screen.getByRole("button", { name: "Play narrated walkthrough" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    const replacement = await openGuide();
    await act(async () => {
      reject(new DOMException("Canceled", "AbortError"));
    });
    expect(screen.queryByRole("alert")).toBeNull();
    expect(replacement).not.toHaveAttribute("src");
    expect(
      screen.getByRole("button", { name: "Play narrated walkthrough" }),
    ).toBeEnabled();
  });

  it.each(["missing", "invalid"])(
    "offers a written guide and playable media when metadata is %s",
    async (reason) => {
      fetchMock.mockResolvedValueOnce(
        reason === "missing"
          ? new Response("Missing", { status: 404 })
          : new Response(
              JSON.stringify({
                ...guide,
                chapters: [{ ...guide.chapters[0], start_s: -4 }],
              }),
            ),
      );
      render(<WalkthroughLauncher />);
      fireEvent.click(
        screen.getByRole("button", { name: "See full walkthrough" }),
      );
      await screen.findByText(/Chapter timings are unavailable/);
      fireEvent.click(screen.getByText("Transcript and written guide"));
      expect(
        screen.getByText(/This written setup guide remains available/),
      ).toBeVisible();
      expect(
        screen.getByRole("button", { name: "Play narrated walkthrough" }),
      ).toBeEnabled();
      expect(
        screen.queryByRole("button", { name: "0:12 Review the evidence" }),
      ).toBeNull();
    },
  );
});
