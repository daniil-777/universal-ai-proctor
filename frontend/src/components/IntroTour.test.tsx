import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { IntroTour } from "./IntroTour";

let observerCallback: IntersectionObserverCallback;
let hidden: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.stubGlobal("IntersectionObserver", class {
    constructor(callback: IntersectionObserverCallback) {
      observerCallback = callback;
    }
    observe() {}
    disconnect() {}
  });
  vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
  hidden = vi.spyOn(document, "hidden", "get").mockReturnValue(false);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("homepage Leica workflow and voice demo", () => {
  it("shows actual footage as the poster and downloads the film only after Play", () => {
    render(<IntroTour />);
    const video = screen.getByTestId("intro-tour-video");
    expect(video).not.toHaveAttribute("src");
    expect(video).toHaveAttribute("poster", "/media/cueveris-leica-workflow-demo.jpg");
    expect(video).toHaveAttribute("preload", "none");
    const captions = video.querySelector("track");
    expect(captions).not.toHaveAttribute("src");
    expect(HTMLMediaElement.prototype.play).not.toHaveBeenCalled();
    expect(screen.getByRole("link", { name: "Demo transcript and credits, opens in a new tab" })).toHaveAttribute("href", "/media/cueveris-leica-workflow-demo.txt");
    fireEvent.click(screen.getByRole("button", { name: "Play 63-second Leica UI and voice demo" }));
    expect(video).toHaveAttribute("src", "/media/cueveris-leica-workflow-demo.mp4");
    expect(video).toHaveAttribute("controls");
    expect((video as HTMLVideoElement).muted).toBe(false);
    expect(video).toHaveAttribute("playsinline");
    expect(captions).toHaveAttribute("src", "/media/cueveris-leica-workflow-demo.vtt");
    expect(captions).toHaveAttribute("kind", "captions");
    expect(captions).toHaveAttribute("label", "English");
    expect(captions).not.toHaveAttribute("default");
    expect(screen.getByText("Includes spoken answers · sound and captions in player controls")).toBeVisible();
    expect(HTMLMediaElement.prototype.play).toHaveBeenCalledOnce();
  });

  it("offers a visible sound control fallback when a browser blocks audible playback", async () => {
    vi.mocked(HTMLMediaElement.prototype.play).mockRejectedValueOnce(new DOMException("Sound blocked", "NotAllowedError"));
    render(<IntroTour />);
    fireEvent.click(screen.getByRole("button", { name: "Play 63-second Leica UI and voice demo" }));
    await screen.findByText("Sound was blocked. Use the player’s sound control to hear the voice demo.");
    expect((screen.getByTestId("intro-tour-video") as HTMLVideoElement).muted).toBe(true);
    expect(HTMLMediaElement.prototype.play).toHaveBeenCalledTimes(2);
    expect(screen.getByTestId("intro-tour-video")).toHaveAttribute("controls");
    expect(screen.queryByText(/The demo could not play/)).toBeNull();
  });

  it("does not restart muted playback from a late sound rejection after the page is hidden", async () => {
    let rejectPlay!: (reason: unknown) => void;
    vi.mocked(HTMLMediaElement.prototype.play).mockImplementationOnce(() => new Promise((_, reject) => { rejectPlay = reject; }));
    render(<IntroTour />);
    fireEvent.click(screen.getByRole("button", { name: "Play 63-second Leica UI and voice demo" }));
    hidden.mockReturnValue(true);
    fireEvent(document, new Event("visibilitychange"));
    await act(async () => { rejectPlay(new DOMException("Sound blocked", "NotAllowedError")); });
    expect(HTMLMediaElement.prototype.play).toHaveBeenCalledOnce();
    expect(screen.queryByText(/Sound was blocked/)).toBeNull();
  });

  it.each(["hidden", "offscreen"])("pauses the demo when %s without automatically restarting", async (reason) => {
    render(<IntroTour />);
    fireEvent.click(screen.getByRole("button", { name: "Play 63-second Leica UI and voice demo" }));
    await act(async () => {
      if (reason === "hidden") {
        hidden.mockReturnValue(true);
        document.dispatchEvent(new Event("visibilitychange"));
      } else {
        observerCallback([{ isIntersecting: false } as IntersectionObserverEntry], {} as IntersectionObserver);
      }
    });
    expect(HTMLMediaElement.prototype.pause).toHaveBeenCalled();
    await act(async () => {
      hidden.mockReturnValue(false);
      document.dispatchEvent(new Event("visibilitychange"));
      observerCallback([{ isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver);
    });
    expect(HTMLMediaElement.prototype.play).toHaveBeenCalledOnce();
  });

  it("keeps a written guide available after a media failure and retries only on request", () => {
    render(<IntroTour />);
    const video = screen.getByTestId("intro-tour-video");
    fireEvent.click(screen.getByRole("button", { name: "Play 63-second Leica UI and voice demo" }));
    fireEvent.error(video);
    expect(screen.getByRole("status")).toHaveTextContent("The demo could not play");
    expect(video).not.toHaveAttribute("src");
    fireEvent.click(screen.getByText("Read the quick-start guide"));
    expect(screen.getByText("Choose a recorded video, connect your camera, or share a screen.")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Retry demo" }));
    expect(video).toHaveAttribute("src", "/media/cueveris-leica-workflow-demo.mp4");
    expect(HTMLMediaElement.prototype.play).toHaveBeenCalledTimes(2);
  });

  it("pauses when another film opens and does not restart when that film closes", () => {
    const { rerender } = render(<IntroTour />);
    fireEvent.click(screen.getByRole("button", { name: "Play 63-second Leica UI and voice demo" }));
    rerender(<IntroTour paused />);
    expect(HTMLMediaElement.prototype.pause).toHaveBeenCalled();
    rerender(<IntroTour paused={false} />);
    expect(HTMLMediaElement.prototype.play).toHaveBeenCalledOnce();
  });
});
