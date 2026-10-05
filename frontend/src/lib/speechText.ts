/** Keep spoken text readable without reading Markdown punctuation aloud. */
export function spokenText(text: string): string {
  return text
    .replace(/```[^\n]*\n?/g, "")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/^\s*(?:#{1,6}\s+|[-*+]\s+|\d+[.)]\s+)/gm, "")
    .replace(/\*\*([^*\n]+)\*\*|__([^_\n]+)__/g, (_match, bold, underlined) => bold ?? underlined)
    .replace(/(^|\s)([*_])(\S(?:.*?\S)?)\2(?=\s|[.,:;!?]|$)/g, "$1$3")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\s+/g, " ").trim();
}

/** A stable prefix: require text after the punctuation so a streamed decimal,
 * abbreviation or sentence whose punctuation hasn't arrived isn't cut in half. */
export function firstSpeechSentence(text: string): string | null {
  const value = spokenText(text);
  for (const match of value.matchAll(/[.!?]["”')\]]*\s+(?=\S)/g)) {
    const end = match.index! + match[0].trimEnd().length;
    const prefix = value.slice(0, end);
    if (/(?:\b(?:Mr|Mrs|Ms|Dr|Prof|Sr|Jr|etc|vs|approx|No|Fig)|\b[A-Z]|e\.g|i\.e)\.$/i.test(prefix)) continue;
    if (prefix.length < 12 || prefix.split(" ").length < 3) continue;
    return prefix.length <= 350 ? prefix : null;
  }
  return null;
}
