import { expect, it } from "vitest";
import { spokenText, firstSpeechSentence } from "./speechText";
it("removes formatting while preserving measurements, uncertainty and link text", () => {
  expect(spokenText("## Observation\n- **Possibly** 2.5 mm; verify [the reference](https://example.test)."))
    .toBe("Observation Possibly 2.5 mm; verify the reference.");
  expect(spokenText("*Check* `2*3`, -1.5 °C and device_id; keep 5_000 unchanged."))
    .toBe("Check 2*3, -1.5 °C and device_id; keep 5_000 unchanged.");
});
it("waits for a stable sentence and keeps abbreviations and decimal values intact", () => {
  expect(firstSpeechSentence("Inspect the visible part.")).toBeNull();
  expect(firstSpeechSentence("Ask Dr. Smith about the 2.5 mm marker. Then inspect it."))
    .toBe("Ask Dr. Smith about the 2.5 mm marker.");
  expect(firstSpeechSentence("Measure 2.")).toBeNull();
  expect(firstSpeechSentence("Measure 2.5 mm. Compare the reference." )).toBe("Measure 2.5 mm.");
  expect(firstSpeechSentence("The visible reading is 95. Check the reference." )).toBe("The visible reading is 95.");
});
it("does not synthesize incomplete, excessively long or punctuation-only prefixes", () => {
  expect(firstSpeechSentence("The current view suggests" )).toBeNull();
  expect(firstSpeechSentence("Wait. We need more detail" )).toBeNull();
  expect(firstSpeechSentence("A ".repeat(200) + ". Then check." )).toBeNull();
});
