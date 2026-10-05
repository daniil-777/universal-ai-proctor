import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SampleVideo } from "@/lib/useSampleDocuments";
import { SampleVideoSelect } from "./SampleVideoSelect";

const state = vi.hoisted(() => ({
  app: {
    apiBase: "",
    uploading: false,
    referenceLoading: false,
    sourceKind: null as "video" | "camera" | null,
    sourceName: "",
    sampleVideoId: null as string | null,
    sourceReady: false,
    serverVideoReady: false,
    sourceFile: null as File | null,
    loadSampleVideo: vi.fn(),
  },
  catalog: {
    data: [] as SampleVideo[],
    isPending: false,
    isFetching: false,
    isError: false,
    refetch: vi.fn(),
  },
}));
vi.mock("@/lib/store", () => ({ useApp: () => state.app }));
vi.mock("@/lib/useSampleDocuments", () => ({ useSampleVideos: () => state.catalog }));

const original: SampleVideo = {
  id: "original-cholecystectomy",
  name: "Uncomplicated cholecystectomy",
  description: "Original default surgery training video",
  guidance: "Cholecystectomy.txt",
  default: true,
  duration_s: 252.77,
};
const house: SampleVideo = {
  id: "real-house-construction",
  name: "House construction observation",
  description: "Visible framing sequence; measurements need operator verification.",
  guidance: "Real_01_House_Construction.txt",
  default: false,
  duration_s: 150,
  source_url: "https://commons.wikimedia.org/wiki/File:House.webm",
  author: "Example author",
  license: "CC BY-SA 4.0",
  license_url: "https://creativecommons.org/licenses/by-sa/4.0/",
  excerpt: { start_s: 30, end_s: 180, source_duration_s: 600, description: "One continuous excerpt." },
  changes: "Excerpted and transcoded; no repeated or slowed footage.",
};
const browserMethods = ["scrollIntoView", "hasPointerCapture", "setPointerCapture", "releasePointerCapture"] as const;
const methodDescriptors = browserMethods.map(name => Object.getOwnPropertyDescriptor(HTMLElement.prototype, name));

beforeEach(() => {
  Object.assign(state.app, {
    uploading: false, referenceLoading: false, sourceKind: null, sourceName: "", sampleVideoId: null,
    sourceReady: false, serverVideoReady: false, sourceFile: null,
  });
  Object.assign(state.catalog, { data: [original, house], isPending: false, isFetching: false, isError: false });
  vi.clearAllMocks();
  vi.stubGlobal("PointerEvent", MouseEvent);
  for (const name of browserMethods)
    Object.defineProperty(HTMLElement.prototype, name, { configurable: true, writable: true, value: vi.fn(() => name === "hasPointerCapture" ? false : undefined) });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  browserMethods.forEach((name, index) => {
    const descriptor = methodDescriptors[index];
    if (descriptor) Object.defineProperty(HTMLElement.prototype, name, descriptor);
    else delete HTMLElement.prototype[name];
  });
});

describe("sample-video selection and attribution", () => {
  it("offers original and real examples and loads the chosen catalog id with its name", () => {
    render(<SampleVideoSelect />);
    fireEvent.keyDown(screen.getByRole("combobox", { name: "Choose a sample video" }), { key: "ArrowDown" });
    expect(screen.getByText(/Original default · 4:12/)).toBeVisible();
    expect(screen.getByText("CC BY-SA 4.0 · Example author")).toBeVisible();
    fireEvent.click(screen.getByRole("option", { name: /House construction observation/ }));
    expect(state.app.loadSampleVideo).toHaveBeenCalledExactlyOnceWith(house.id, house.name);
  });

  it("shows source, license and disclosed excerpt only for the active bundled stream", () => {
    Object.assign(state.app, { sourceKind: "video", sourceName: house.name, sampleVideoId: house.id, sourceReady: true, serverVideoReady: true });
    const view = render(<SampleVideoSelect />);
    expect(screen.getByRole("link", { name: "Original source" })).toHaveAttribute("href", house.source_url);
    expect(screen.getByRole("link", { name: "Video license" })).toHaveAttribute("rel", "noopener noreferrer");
    expect(screen.getByText(/Source excerpt 0:30–3:00 of 10:00 original recording/)).toBeVisible();
    expect(screen.getByText(/Changes: Excerpted and transcoded/)).toBeVisible();
    // An uploaded file with an identical visible name must not inherit attribution.
    state.app.sourceFile = new File(["fixture"], "same-name.mp4");
    view.rerender(<SampleVideoSelect />);
    expect(screen.queryByRole("link", { name: "Original source" })).not.toBeInTheDocument();
    Object.assign(state.app, { sourceFile: null, sourceKind: "camera" });
    view.rerender(<SampleVideoSelect />);
    expect(screen.queryByText(/Source excerpt/)).not.toBeInTheDocument();
    // Restoring a same-named custom server upload leaves sourceFile null, but
    // carries no bundled id and must not acquire this source's attribution.
    Object.assign(state.app, { sourceKind: "video", sampleVideoId: null });
    view.rerender(<SampleVideoSelect />);
    expect(screen.queryByRole("link", { name: "Original source" })).not.toBeInTheDocument();
  });

  it("keeps loading disabled and makes catalog failure retryable", () => {
    state.catalog.isPending = true;
    const view = render(<SampleVideoSelect />);
    expect(screen.getByRole("combobox", { name: "Choose a sample video" })).toBeDisabled();
    Object.assign(state.catalog, { isPending: false, isError: true, data: [] });
    view.rerender(<SampleVideoSelect />);
    expect(screen.getByText("Sample videos could not load.")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Retry video samples" }));
    expect(state.catalog.refetch).toHaveBeenCalledOnce();
    expect(state.app.loadSampleVideo).not.toHaveBeenCalled();
  });

  it("shows an actionable empty catalog and never links an unsafe attribution URL", () => {
    state.catalog.data = [];
    const view = render(<SampleVideoSelect />);
    expect(screen.getByText("No bundled videos are installed. Upload a video to continue.")).toBeVisible();
    state.catalog.data = [{ ...house, source_url: "javascript:alert(1)", license_url: "javascript:alert(1)" }];
    Object.assign(state.app, { sourceKind: "video", sourceName: house.name, sampleVideoId: house.id, sourceReady: true, serverVideoReady: true });
    view.rerender(<SampleVideoSelect />);
    expect(screen.getByText("Video by Example author. CC BY-SA 4.0")).toBeVisible();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });
});
