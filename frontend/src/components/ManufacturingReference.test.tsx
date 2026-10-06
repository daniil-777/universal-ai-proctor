import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ManufacturingReference } from "./ManufacturingReference";
import { BackendConnectionNotice } from "./BackendConnectionNotice";

const deployment = vi.hoisted(() => ({ staticPreview: false }));
vi.mock("@/lib/deployment", async importOriginal => ({
  ...await importOriginal<typeof import("@/lib/deployment")>(),
  isStaticHosting: () => deployment.staticPreview,
}));

const app = vi.hoisted(() => ({
  loadGuidance: vi.fn(),
  resetSource: vi.fn(),
  setRunning: vi.fn(),
  setMonitor: vi.fn(),
  stopLiveVideo: vi.fn(),
  setVideoUrl: vi.fn(),
  setAnalysis: vi.fn(),
  setReferenceFilm: vi.fn(),
  setCaseName: vi.fn(),
  setIntroDone: vi.fn(),
}));
vi.mock("@/lib/store", () => ({ useApp: () => ({ ...app, apiBase: "", health: null }) }));

let observerCallback: IntersectionObserverCallback;
let hidden: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  deployment.staticPreview = false;
  Object.values(app).forEach(mock => mock.mockReset());
  app.loadGuidance.mockResolvedValue(true);
  app.resetSource.mockResolvedValue("source-reference");
  vi.stubGlobal("IntersectionObserver", class {
    constructor(callback: IntersectionObserverCallback) {
      observerCallback = callback;
    }
    observe() {}
    disconnect() {}
  });
  hidden = vi.spyOn(document, "hidden", "get").mockReturnValue(false);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function openReference() {
  fireEvent.click(screen.getByRole("button", { name: "Watch official film" }));
  return screen.getByRole("dialog");
}

describe("official manufacturing reference", () => {
  it("loads no third-party player or thumbnail until the user explicitly presses Play", () => {
    const { container } = render(<ManufacturingReference />);
    expect(container.querySelector("iframe")).toBeNull();
    expect(container.querySelector("img")).toBeNull();
    openReference();
    expect(document.querySelector("iframe")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Play official Leica film" }));
    const iframe = screen.getByTitle("Official Leica Camera film: Leica M10 assembly");
    expect(iframe).toHaveAttribute("src", "https://www.youtube-nocookie.com/embed/p4t-OVIvuy8?autoplay=1&playsinline=1&rel=0");
    expect(iframe).toHaveAttribute("referrerpolicy", "strict-origin-when-cross-origin");
    expect(iframe).toHaveAttribute("allowfullscreen");
    expect(screen.queryByRole("button", { name: "Play official Leica film" })).toBeNull();
  });

  it("keeps the original source and a usable fallback outside the player", () => {
    render(<ManufacturingReference />);
    openReference();
    const link = screen.getByRole("link", { name: /Open original on YouTube/ });
    expect(link).toHaveAttribute("href", "https://www.youtube.com/watch?v=p4t-OVIvuy8");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
    expect(screen.getByText(/Official reference/)).toHaveTextContent("no endorsement is implied");
    fireEvent.click(screen.getByRole("button", { name: "Play official Leica film" }));
    expect(link).toBeVisible();
    expect(link.closest(".intro-reference-player")).toBeNull();
    expect(screen.getByText(/If playback is unavailable/)).toBeVisible();
  });

  it("keeps a YouTube fallback instead of embedding a player below the minimum width", () => {
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({ width: 180 } as DOMRect);
    render(<ManufacturingReference />);
    openReference();
    fireEvent.click(screen.getByRole("button", { name: "Play official Leica film" }));
    expect(screen.getByRole("button", { name: "Play official Leica film" })).toBeDisabled();
    expect(screen.getByText(/This view is too narrow/)).toBeVisible();
    expect(screen.getByRole("link", { name: /Open original on YouTube/ })).toBeVisible();
    expect(document.querySelector("iframe")).toBeNull();
  });

  it("unloads the player on close and returns focus to the launch button", async () => {
    render(<ManufacturingReference />);
    openReference();
    fireEvent.click(screen.getByRole("button", { name: "Play official Leica film" }));
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(document.querySelector("iframe")).toBeNull();
    await waitFor(() => expect(screen.getByRole("button", { name: "Watch official film" })).toHaveFocus());
    openReference();
    expect(document.querySelector("iframe")).toBeNull();
  });

  it.each(["hidden", "offscreen"])("stops external playback when %s and resumes only on Play", async (reason) => {
    render(<ManufacturingReference />);
    openReference();
    fireEvent.click(screen.getByRole("button", { name: "Play official Leica film" }));
    await act(async () => {
      if (reason === "hidden") {
        hidden.mockReturnValue(true);
        document.dispatchEvent(new Event("visibilitychange"));
      } else {
        observerCallback([{ isIntersecting: false } as IntersectionObserverEntry], {} as IntersectionObserver);
      }
    });
    expect(document.querySelector("iframe")).toBeNull();
    await act(async () => {
      hidden.mockReturnValue(false);
      document.dispatchEvent(new Event("visibilitychange"));
      observerCallback([{ isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver);
    });
    expect(document.querySelector("iframe")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Play official Leica film" }));
    expect(document.querySelector("iframe")).not.toBeNull();
  });

  it("applies the actual Leica guide before entering the workspace, without starting observation", async () => {
    const fetchGuide = vi.fn().mockResolvedValue(new Response("Leica M10 observation guide\n## Step 1\nReview visible assembly."));
    vi.stubGlobal("fetch", fetchGuide);
    render(<ManufacturingReference />);
    fireEvent.click(screen.getByRole("button", { name: "Use Leica guidance" }));
    await waitFor(() => expect(app.setIntroDone).toHaveBeenCalledWith(true));
    expect(fetchGuide).toHaveBeenCalledWith("/media/leica-m10-guidance.txt");
    const file = app.loadGuidance.mock.calls[0][0] as File;
    expect(file.name).toBe("leica-m10-guidance.txt");
    expect(file.type).toBe("text/plain");
    expect(file.size).toBeGreaterThan(0);
    expect(app.loadGuidance.mock.invocationCallOrder[0]).toBeLessThan(app.setIntroDone.mock.invocationCallOrder[0]);
    expect(app.resetSource).toHaveBeenCalledWith("screen", "Leica M10 guide — no shared input");
    expect(app.resetSource.mock.invocationCallOrder[0]).toBeLessThan(app.loadGuidance.mock.invocationCallOrder[0]);
    expect(app.setRunning).toHaveBeenCalledWith(false);
    expect(app.setMonitor).toHaveBeenCalledWith({ active: false });
    expect(app.setVideoUrl).toHaveBeenCalledWith(null);
    expect(app.setReferenceFilm).toHaveBeenCalledWith("leica-m10");
    expect(document.querySelector("iframe")).toBeNull();
  });

  it.each(["guide unavailable", "backend unavailable"])("keeps the homepage available and offers retry when %s", async reason => {
    const fetchGuide = vi.fn().mockResolvedValue(reason === "guide unavailable"
      ? new Response("Missing", { status: 404 })
      : new Response("Leica M10 observation guide"));
    vi.stubGlobal("fetch", fetchGuide);
    app.loadGuidance.mockResolvedValue(false);
    render(<ManufacturingReference />);
    fireEvent.click(screen.getByRole("button", { name: "Use Leica guidance" }));
    await screen.findByRole("alert");
    expect(app.setIntroDone).not.toHaveBeenCalled();
    if (reason === "guide unavailable") {
      expect(app.stopLiveVideo).not.toHaveBeenCalled();
      expect(app.resetSource).not.toHaveBeenCalled();
    }
    expect(app.setReferenceFilm).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Retry Leica guidance" })).toBeEnabled();
  });

  it("offers guide download and opens the existing connection dialog in a disconnected public preview", () => {
    deployment.staticPreview = true;
    const fetchGuide = vi.fn();
    vi.stubGlobal("fetch", fetchGuide);
    render(<><BackendConnectionNotice /><ManufacturingReference /></>);
    expect(screen.queryByRole("button", { name: "Use Leica guidance" })).toBeNull();
    const download = screen.getByRole("link", { name: "Download Leica guide (.txt)" });
    expect(download).toHaveAttribute("href", "/media/leica-m10-guidance.txt");
    expect(download).toHaveAttribute("download", "leica-m10-guidance.txt");
    fireEvent.click(screen.getByRole("button", { name: "Connect backend to use guide" }));
    expect(screen.getByRole("dialog")).toHaveAccessibleName("Connect your AI workspace");
    expect(screen.getByRole("textbox", { name: "Backend address" })).toBeVisible();
    expect(fetchGuide).not.toHaveBeenCalled();
    expect(app.resetSource).not.toHaveBeenCalled();
    expect(app.loadGuidance).not.toHaveBeenCalled();
  });
});
