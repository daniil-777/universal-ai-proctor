import { describe, expect, it } from "vitest";
import {
  stripWakeWord,
  startsWithWakeWord,
  findWakeWordAnywhere,
} from "./wakeWord";
describe("voice controls", () => {
  it("captures explicit wake-word questions with punctuation", () => {
    expect(stripWakeWord('  "Hey, what is next?')).toBe("what is next?");
    expect(stripWakeWord("Hi! explain the principle")).toBe(
      "explain the principle",
    );
  });
  it("ignores background speech and partial word matches", () => {
    expect(stripWakeWord("The tool is on the table")).toBeNull();
    expect(startsWithWakeWord("higher pressure")).toBe(false);
    expect(stripWakeWord("hey?")).toBe("");
  });
  it("supports interruption using the final wake word during playback", () => {
    expect(
      findWakeWordAnywhere("The answer is long. Hey wait. Hi explain that"),
    ).toBe("explain that");
  });
});
