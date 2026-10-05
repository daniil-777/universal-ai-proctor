// sessionHistory.ts — the COMPACT SESSION HISTORY representation.
//
// One bounded text block (≤ ~1.4 KB) giving the LLM the past of the session:
//   • Stage path      — deterministic stage transitions with video times (free, exact)
//   • Incidents       — last Guardian alerts with video times
//   • Digest          — rolling ≤60-word AI narrative (constant-size memory)
//   • Recent Q&A      — last exchanges, answers reduced to their gist
// Explicitly labeled PAST so the model never lets it override the current frames
// or the (current) SIMULATOR CONTEXT block that follows it in the prompt.

import type { ChatMessage } from "./types";
import type { GuardianEntry, SessionEvent } from "./store";

const fmtVideo = (s: number) =>
  `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

const gist = (s: string, max = 140): string => {
  const first =
    s
      .replace(/\s+/g, " ")
      .trim()
      .split(/(?<=[.!?])\s/)[0] ?? "";
  return first.length > max ? first.slice(0, max - 1) + "…" : first;
};

export interface HistoryInputs {
  sessionEvents: SessionEvent[];
  guardianLog: GuardianEntry[];
  chat: ChatMessage[];
  sessionDigest: string;
}

export function buildHistoryBlock(s: HistoryInputs): string {
  const lines: string[] = [];

  // Stage path — last 6 transitions.
  const stages = s.sessionEvents.filter((e) => e.type === "stage").slice(-6);
  if (stages.length) {
    lines.push(
      `Stage path: ${stages.map((e) => `${e.text} @${fmtVideo(e.videoS)}`).join(" → ")}`,
    );
  }

  // Incidents — last 5 Guardian alerts (watches only if no alerts).
  const alerts = s.guardianLog.filter((e) => e.status === "alert").slice(-5);
  const incidents = alerts.length
    ? alerts
    : s.guardianLog.filter((e) => e.status === "watch").slice(-3);
  if (incidents.length) {
    lines.push(
      `Incidents: ${incidents
        .map(
          (e) =>
            `[${typeof e.videoS === "number" ? fmtVideo(e.videoS) : "--:--"}] ${e.text.slice(0, 90)}`,
        )
        .join(" · ")}`,
    );
  }

  // Rolling AI digest.
  if (s.sessionDigest) lines.push(`Digest: ${s.sessionDigest}`);

  // Recent Q&A — last 3 exchanges, answer gist only.
  const pairs: string[] = [];
  for (let i = s.chat.length - 1; i >= 0 && pairs.length < 3; i--) {
    const m = s.chat[i]!;
    if (m.role !== "user") continue;
    const ans = s.chat
      .slice(i + 1)
      .find((x) => x.role === "assistant" && !x.streaming && !!x.text);
    if (ans && !ans.text.startsWith("⚠") && !ans.text.startsWith("🛡️")) {
      pairs.unshift(`  Q: ${m.text.slice(0, 120)} → A: ${gist(ans.text)}`);
    }
  }
  if (pairs.length) {
    lines.push("Recent Q&A:");
    lines.push(...pairs);
  }

  if (!lines.length) return "";

  const block = [
    "=== SESSION HISTORY (compact, PAST context — the current frames and SIMULATOR CONTEXT override anything here) ===",
    ...lines,
    "=== END SESSION HISTORY ===",
  ].join("\n");
  return block.length > 1400 ? block.slice(0, 1397) + "…" : block;
}
