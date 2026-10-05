import { afterEach, describe, expect, it } from "vitest";
import { SessionStore } from "../src/domain/session.js";
import { ObservationSchema } from "../src/domain/guidance.js";
import { observationContext } from "../src/pipeline/observationContext.js";
import { FrameBody, observationPrompt } from "../src/pipeline/guidance.js";

const store = new SessionStore();
afterEach(() => store.clear());
const session = () => {
  const s = store.get("scene-context");
  s.observations = [
    {
      time: 12,
      value: ObservationSchema.parse({
        guidance: "",
        summary: "Earlier dissection",
      }),
    },
    {
      time: 105,
      value: ObservationSchema.parse({ guidance: "", summary: "Earlier haze" }),
    },
    {
      time: 215,
      value: ObservationSchema.parse({
        guidance: "",
        summary: "Recent visible clips",
      }),
    },
    {
      time: 230,
      value: ObservationSchema.parse({
        guidance: "",
        summary: "Future scene after seek",
      }),
    },
  ];
  return s;
};

describe("visual scene context after playback changes", () => {
  it("keeps current-window context without anchoring late surgical views to earlier dissection", () => {
    const s = session();
    const prompt = observationPrompt(s, FrameBody.parse({ current_s: 216 }));
    expect(prompt).toContain("Recent visible clips");
    expect(prompt).not.toContain("Earlier dissection");
    expect(prompt).not.toContain("Earlier haze");
    expect(prompt).not.toContain("Future scene after seek");
    expect(prompt).toContain(
      "Expected equipment in the document is not evidence",
    );
    expect(prompt).toContain("without proving any skipped earlier criteria");
  });
  it("preserves explicitly requested past context while excluding future observations after a rewind", () => {
    const s = session();
    expect(observationContext(s, 216, true).map((o) => o.summary)).toEqual([
      "Earlier dissection",
      "Earlier haze",
      "Recent visible clips",
    ]);
    expect(observationContext(s, 12, true).map((o) => o.summary)).toEqual([
      "Earlier dissection",
    ]);
    expect(observationContext(s, 5)).toEqual([]);
  });
});
