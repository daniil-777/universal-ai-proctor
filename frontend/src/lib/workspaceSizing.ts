export const WORKSPACE_SIZING_KEY = "cueveris-workspace-sizing-v1";
export const MIN_GUIDANCE_TEXT_SIZE = 10;
export const MAX_GUIDANCE_TEXT_SIZE = 48;

export type WorkspaceSizing = {
  guidanceWidthPx: number;
  guidanceHeightPx: number;
  editorHeightPx: number;
  textSizePx: number;
};

export const DEFAULT_WORKSPACE_SIZING: WorkspaceSizing = {
  guidanceWidthPx: 380,
  guidanceHeightPx: 0,
  editorHeightPx: 0,
  textSizePx: 14,
};

export function clampSize(value: number, min: number, max: number) {
  return Math.round(Math.min(Math.max(Number.isFinite(value) ? value : min, min), max));
}

export function parseWorkspaceSizing(raw: string | null): WorkspaceSizing {
  try {
    const saved = raw ? JSON.parse(raw) : {};
    const number = (key: keyof WorkspaceSizing, min: number, max: number) =>
      typeof saved[key] === "number" && Number.isFinite(saved[key])
        ? clampSize(saved[key], min, max)
        : DEFAULT_WORKSPACE_SIZING[key];
    return {
      guidanceWidthPx: number("guidanceWidthPx", 180, 10000),
      guidanceHeightPx: number("guidanceHeightPx", 0, 10000),
      editorHeightPx: number("editorHeightPx", 0, 10000),
      textSizePx: number("textSizePx", MIN_GUIDANCE_TEXT_SIZE, MAX_GUIDANCE_TEXT_SIZE),
    };
  } catch {
    return { ...DEFAULT_WORKSPACE_SIZING };
  }
}

export function readWorkspaceSizing(): WorkspaceSizing {
  try { return parseWorkspaceSizing(localStorage.getItem(WORKSPACE_SIZING_KEY)); }
  catch { return { ...DEFAULT_WORKSPACE_SIZING }; }
}

export function saveWorkspaceSizing(value: WorkspaceSizing) {
  try { localStorage.setItem(WORKSPACE_SIZING_KEY, JSON.stringify(value)); }
  catch { /* Sizing remains available when storage is blocked. */ }
}

export function workspaceSizingBounds(width: number, height: number, stacked: boolean) {
  const minWidth = Math.min(220, Math.floor(width / 2));
  const minVideoWidth = Math.min(240, Math.floor(width / 2));
  const minHeight = Math.min(180, Math.floor(height * .4));
  const minVideoHeight = Math.min(220, Math.floor(height * .4));
  return {
    minWidth,
    maxWidth: stacked ? width : Math.max(minWidth, width - minVideoWidth),
    minHeight,
    maxHeight: stacked ? Math.max(minHeight, height - minVideoHeight) : height,
    minVideoWidth,
    minVideoHeight,
  };
}
