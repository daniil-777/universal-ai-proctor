const KEY = "process-guide-session";
const fallback = crypto.randomUUID();
export function sessionId(): string {
  const path = window.location.hash.startsWith("#/")
    ? window.location.hash.slice(1)
    : `/${window.location.pathname.slice(appBasePath().length).replace(/^\/+/, "")}`;
  const shared = /^\/share\/([a-zA-Z0-9_-]{16,80})$/.exec(path)?.[1];
  if (shared) return shared;
  try {
    let id = sessionStorage.getItem(KEY);
    if (!id) {
      id = crypto.randomUUID();
      sessionStorage.setItem(KEY, id);
    }
    return id;
  } catch {
    return fallback;
  }
}
export async function apiFetch(
  input: RequestInfo | URL,
  init: RequestInit = {},
): Promise<Response> {
  if (staticApiUnavailable(input))
    return new Response(JSON.stringify({
      ok: false,
      error: "Connect an AI backend to analyze videos, load guidance and save results. The public preview does not run AI analysis.",
    }), { status: 503, headers: { "Content-Type": "application/json" } });
  const headers = new Headers(init.headers);
  headers.set("X-Guidance-Session", sessionId());
  const response = await fetch(input, { ...init, headers });
  const url = String(input);
  if (
    response.ok &&
    init.method &&
    !["GET", "HEAD"].includes(init.method.toUpperCase()) &&
    /\/api\/reference(?:\/|$)/.test(url)
  )
    window.dispatchEvent(new CustomEvent("guidance-reference-updated"));
  return response;
}
export async function apiJson<T>(
  input: string,
  init: RequestInit = {},
): Promise<T> {
  const response = await apiFetch(input, init);
  const body = await response.json();
  if (!response.ok || body.ok === false)
    throw new Error(body.error || `Request failed: ${response.status}`);
  return body as T;
}
export function mediaUrl(base: string, route: string): string {
  return `${base}${route}${route.includes("?") ? "&" : "?"}session=${sessionId()}`;
}
import { appBasePath, staticApiUnavailable } from "./deployment";
