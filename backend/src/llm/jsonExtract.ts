// src/llm/jsonExtract.ts — port of phase_detector._extract_json (spec §5.3).
// Best-effort extraction of a single JSON object from free-form LLM text.
// Never throws; returns {} when nothing parseable is found.

export function extractJson(text: string): Record<string, unknown> {
  if (!text) return {};

  // Strip markdown code fences (```json / ```), case-insensitive, then trim.
  const stripped = text.replace(/```(?:json)?/gi, "").trim();

  // 1) Direct parse.
  const direct = tryParseObject(stripped);
  if (direct) return direct;

  // 2) Fall back to the outermost {...} (dot-matches-newline).
  const match = stripped.match(/\{[\s\S]*\}/);
  if (match) {
    const obj = tryParseObject(match[0]);
    if (obj) return obj;
  }

  return {};
}

function tryParseObject(s: string): Record<string, unknown> | null {
  try {
    const v = JSON.parse(s);
    if (v && typeof v === "object" && !Array.isArray(v)) {
      return v as Record<string, unknown>;
    }
  } catch {
    /* not valid JSON */
  }
  return null;
}
