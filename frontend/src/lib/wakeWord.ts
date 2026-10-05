// wakeWord.ts — faithful port of the Python constant-listening wake-word gate
// (demo_window._strip_wake_word / _WAKE_WORDS, mirrored in backend media/speech.ts).
//
// Only utterances that START with a wake word are treated as questions; everything
// else the OR picks up is dropped silently. English-only, matched case-insensitively
// after trimming leading whitespace / quotes / punctuation the STT may emit.

export const WAKE_WORDS = ["hello", "hey", "hi"] as const;

/**
 * If `text` starts with a wake word, return the remainder (the actual question)
 * trimmed; otherwise return null (caller drops the utterance). An empty remainder
 * ("hey?") is a false trigger and returns "".
 */
export function stripWakeWord(text: string): string | null {
  const stripped = (text || "")
    .replace(/^\s+/, "")
    .replace(/^["'¿¡.,!?\-—–]+/, "");
  const m = /^(hello|hey|hi)\b[\s,.;:!?-]*/i.exec(stripped);
  if (!m) return null;
  return stripped.slice(m[0].length).trim();
}

/** True when the (possibly partial) transcript already begins with a wake word. */
export function startsWithWakeWord(text: string): boolean {
  return stripWakeWord(text) !== null;
}

/**
 * Lenient variant for BARGE-IN while the app itself is speaking: the recognizer's
 * open utterance may already contain transcribed TTS audio before the user says
 * "Hey…", so the wake word won't be at the start. Find the LAST wake word anywhere
 * and return what follows it. Only use while TTS playback is active — in a quiet
 * room the strict start-of-utterance rule stays authoritative.
 */
export function findWakeWordAnywhere(text: string): string | null {
  const re = /\b(hello|hey|hi)\b[\s,.;:!?-]*/gi;
  let last: RegExpExecArray | null = null;
  for (let m = re.exec(text || ""); m; m = re.exec(text || "")) last = m;
  if (!last) return null;
  return (text || "").slice(last.index + last[0].length).trim();
}
