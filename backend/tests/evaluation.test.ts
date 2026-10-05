import { describe, it, expect } from "vitest";
import fs from "node:fs";
import {
  scoreAnswer,
  wordErrorRate,
  referenceOverlap,
  summarize,
} from "../../evaluation/scoring.mjs";
const data = JSON.parse(
  fs.readFileSync(
    new URL("../../evaluation/dataset.json", import.meta.url),
    "utf8",
  ),
);
const find = (name: string) =>
  data.cases.find((test: { id: string }) => test.id.endsWith(":" + name));
describe("prepared video answer metrics", () => {
  it("all published expected answers satisfy their own fact rubrics", () => {
    for (const test of data.cases)
      expect(scoreAnswer(test, test.expected_answer).pass, test.id).toBe(true);
  });
  it("penalizes a fabricated visible block, count and temperature", () => {
    for (const [name, answer] of [
      ["listener-empty", "Yes, there is one blue block inside the box."],
      ["listener-count", "Two blue blocks are visible."],
      ["listener-temperature", "The temperature is 70 degrees Celsius."],
    ]) {
      const score = scoreAnswer(find(name!), answer);
      expect(score.pass).toBe(false);
      expect(score.contradictions.length).toBeGreaterThan(0);
    }
  });
  it("accepts absence and uncertainty without mistaking negation for a positive claim", () => {
    expect(
      scoreAnswer(
        find("listener-empty"),
        "No blue block is visible inside the box.",
      ).pass,
    ).toBe(true);
    expect(
      scoreAnswer(
        find("listener-temperature"),
        "I cannot determine the contents temperature from the video.",
      ).pass,
    ).toBe(true);
    expect(
      scoreAnswer(
        find("listener-hidden"),
        "No, the blue block is hidden inside the closed box.",
      ).pass,
    ).toBe(true);
  });
  it("detects missing answers and semantic errors despite word overlap", () => {
    const test = find("listener-label");
    expect(scoreAnswer(test, "").pass).toBe(false);
    expect(scoreAnswer(test, "The label reads BOX B.").pass).toBe(false);
    expect(
      referenceOverlap(test.expected_answer, "The label reads BOX B."),
    ).toBeGreaterThan(0.5);
  });
  it("does not count a denied visible state as recalled fact", () => {
    const result = scoreAnswer(
      find("guardian-tape"),
      "No tape is visible across the box top.",
    );
    expect(result.pass).toBe(false);
    expect(result.missed_facts).toContain("tape");
    expect(result.contradictions).toContain("denied_visible_tape");
  });
  it("does not flag an explicitly uncertain coffee statement as an assertion", () => {
    const result = scoreAnswer(
      find("listener-mismatch"),
      "No coffee brewing is shown; it is unclear whether coffee has been brewed earlier.",
    );
    expect(result.contradictions).toHaveLength(0);
  });
  it("computes word error rate independently from answer scores", () => {
    expect(
      wordErrorRate("what color is the block", "what color is the block"),
    ).toBe(0);
    expect(
      wordErrorRate("what color is the block", "what colour was the block"),
    ).toBeCloseTo(0.4);
    expect(wordErrorRate("what color is the block", "")).toBe(1);
  });
  it("includes failed calls in benchmark rates and reports latency percentiles", () => {
    const test = find("listener-label");
    const metrics = summarize([
      {
        channel: "Listener",
        latency_ms: 100,
        first_token_ms: 30,
        score: scoreAnswer(test, "BOX A"),
        checks: {},
      },
      {
        channel: "Listener",
        latency_ms: 300,
        first_token_ms: 50,
        score: scoreAnswer(test, "BOX A"),
        checks: {},
      },
      {
        channel: "Listener",
        error: "timeout",
        score: scoreAnswer(test, ""),
        checks: {},
      },
    ]).Listener;
    expect(metrics.cases).toBe(3);
    expect(metrics.errors).toBe(1);
    expect(metrics.contradiction_free_rate).toBeCloseTo(2 / 3);
    expect(metrics.passed).toBe(2);
    expect(metrics.fact_recall).toBeCloseTo(2 / 3);
    expect(metrics.latency_p50_ms).toBe(100);
    expect(metrics.latency_p95_ms).toBe(300);
  });
});
