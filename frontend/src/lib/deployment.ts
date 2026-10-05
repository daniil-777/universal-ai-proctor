const API_STORAGE_KEY = "process-guide-api-base-v1";

export function appBasePath(): string {
  const value = import.meta.env.BASE_URL || "/";
  return `${value.replace(/\/+$/, "")}/`;
}

export function appAsset(path: string): string {
  return `${appBasePath()}${path.replace(/^\/+/, "")}`;
}

export function isStaticHosting(): boolean {
  return import.meta.env.VITE_STATIC_HOSTING === "true" ||
    window.location.hostname.endsWith(".github.io");
}

export function appRoute(path: string): string {
  return `${appBasePath()}${isStaticHosting() ? "#" : ""}${path.replace(/^\/+/, isStaticHosting() ? "/" : "")}`;
}

export function normalizeApiBase(value: string): string {
  return value.trim().replace(/\/+$/, "");
}

export function fullAppUrl(): string | null {
  const configured = import.meta.env.VITE_FULL_APP_URL?.trim();
  if (!configured) return null;
  try {
    const url = new URL(configured);
    return ["https:", "http:"].includes(url.protocol) && !url.username && !url.password
      ? url.href : null;
  } catch { return null; }
}

export function initialApiBase(): string {
  const configured = import.meta.env.VITE_API_BASE_URL || import.meta.env.VITE_API_BASE;
  if (configured?.trim()) return normalizeApiBase(configured);
  if (isStaticHosting()) {
    try {
      const saved = localStorage.getItem(API_STORAGE_KEY);
      if (saved && /^https?:\/\//i.test(saved)) return normalizeApiBase(saved);
    } catch { /* A connection can also be configured without storage. */ }
  }
  return window.location.origin;
}

export function persistApiBase(value: string): void {
  if (!isStaticHosting()) return;
  try {
    const base = normalizeApiBase(value);
    if (base && base !== window.location.origin) localStorage.setItem(API_STORAGE_KEY, base);
    else localStorage.removeItem(API_STORAGE_KEY);
  } catch { /* The current connection remains usable without storage. */ }
}

export function staticApiUnavailable(input: RequestInfo | URL): boolean {
  if (!isStaticHosting()) return false;
  const raw = input instanceof Request ? input.url : String(input);
  try {
    const url = new URL(raw, window.location.origin);
    return url.origin === window.location.origin && /\/api(?:\/|$)/.test(url.pathname);
  } catch { return false; }
}
