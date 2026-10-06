import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ManufacturingReference } from "./ManufacturingReference";

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
    expect(screen.getByText(/Watch-only reference/)).toHaveTextContent("no endorsement is implied");
    fireEvent.click(screen.getByRole("button", { name: "Play official Leica film" }));
    expect(link).toBeVisible();
    expect(link.closest(".intro-reference-player")).toBeNull();
    expect(screen.getByText(/If playback is unavailable/)).toBeVisible();
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
});
