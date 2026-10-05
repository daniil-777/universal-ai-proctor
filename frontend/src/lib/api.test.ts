import { afterEach, expect, it, vi } from "vitest";
import { apiFetch, apiJson, mediaUrl, sessionId } from "./api";
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  sessionStorage.clear();
  window.history.replaceState({}, "", "/");
});
it("persists an opaque session across requests and attaches the header", async () => {
  const first = sessionId();
  expect(sessionId()).toBe(first);
  const fetch = vi.fn(
    async (_input: RequestInfo | URL, _init?: RequestInit) =>
      new Response('{"ok":true}'),
  );
  vi.stubGlobal("fetch", fetch);
  await apiFetch("/api/session");
  expect(
    new Headers(fetch.mock.calls[0]![1]!.headers).get("X-Guidance-Session"),
  ).toBe(first);
  expect(mediaUrl("", "/api/video/clip?start_s=0&end_s=2")).toContain(
    `&session=${first}`,
  );
});
it("shares the actual session with a popped-out chat", () => {
  const id = crypto.randomUUID();
  window.history.replaceState({}, "", `/share/${id}`);
  expect(sessionId()).toBe(id);
});
it("propagates useful API errors", async () => {
  vi.stubGlobal(
    "fetch",
    async () =>
      new Response('{"ok":false,"error":"Provider unavailable"}', {
        status: 503,
      }),
  );
  await expect(apiJson("/api/health")).rejects.toThrow("Provider unavailable");
});

it("does not issue unavailable AI requests to a static public host", async () => {
  vi.stubEnv("VITE_STATIC_HOSTING", "true");
  const fetch = vi.fn();
  vi.stubGlobal("fetch", fetch);
  await expect(apiJson("/api/health")).rejects.toThrow("Connect an AI backend");
  expect(fetch).not.toHaveBeenCalled();
});

it("uses the actual shared session in a Pages hash route", () => {
  vi.stubEnv("BASE_URL", "/universal-ai-proctor/");
  const id = crypto.randomUUID();
  window.history.replaceState({}, "", `/universal-ai-proctor/#/share/${id}`);
  expect(sessionId()).toBe(id);
});
