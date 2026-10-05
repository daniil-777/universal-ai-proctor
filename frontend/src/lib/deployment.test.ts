import { afterEach, expect, it, vi } from "vitest";
import { appAsset, appRoute, initialApiBase, persistApiBase, staticApiUnavailable } from "./deployment";

afterEach(() => { vi.unstubAllEnvs(); localStorage.clear(); });

it("keeps local paths and the same-origin backend while honoring an explicit API deployment", () => {
  expect(appAsset("/media/tour.mp4")).toBe("/media/tour.mp4");
  expect(appRoute("/share/session")).toBe("/share/session");
  expect(initialApiBase()).toBe(window.location.origin);
  vi.stubEnv("VITE_API_BASE_URL", " https://api.example.com/workspace/ ");
  expect(initialApiBase()).toBe("https://api.example.com/workspace");
  expect(staticApiUnavailable("/api/health")).toBe(false);
});

it("prefixes bundled media and creates reload-safe share routes for Pages", () => {
  vi.stubEnv("BASE_URL", "/universal-ai-proctor/");
  vi.stubEnv("VITE_STATIC_HOSTING", "true");
  expect(appAsset("/media/tour.mp4")).toBe("/universal-ai-proctor/media/tour.mp4");
  expect(appRoute("/share/session")).toBe("/universal-ai-proctor/#/share/session");
  expect(appRoute("/")).toBe("/universal-ai-proctor/#/");
});

it("blocks static-origin API calls while permitting a connected backend and bundled assets", () => {
  vi.stubEnv("VITE_STATIC_HOSTING", "true");
  expect(staticApiUnavailable(`${window.location.origin}/api/health`)).toBe(true);
  expect(staticApiUnavailable("/nested/api/session")).toBe(true);
  expect(staticApiUnavailable("https://api.example.com/api/health")).toBe(false);
  expect(staticApiUnavailable("/media/tour.mp4")).toBe(false);
});

it("persists only the public-preview connection and preserves the legacy build setting", () => {
  vi.stubEnv("VITE_STATIC_HOSTING", "true");
  persistApiBase("https://api.example.com/");
  expect(initialApiBase()).toBe("https://api.example.com");
  vi.stubEnv("VITE_API_BASE", "https://legacy.example.com/");
  expect(initialApiBase()).toBe("https://legacy.example.com");
});
