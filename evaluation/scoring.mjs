// Deterministic, reviewable rubric scoring. These targeted checks are not an
// exhaustive semantic judge; raw answers remain available for human review.
export function tokens(text) {
  return (
    String(text || "")
      .normalize("NFKC")
      .toLowerCase()
      .match(/[\p{L}\p{N}]+/gu) || []
  );
}
export function referenceOverlap(reference, answer) {
  const a = tokens(reference).slice(0, 400),
    b = tokens(answer).slice(0, 400);
  if (!a.length || !b.length) return 0;
  let previous = new Uint16Array(b.length + 1);
  for (const word of a) {
    const next = new Uint16Array(b.length + 1);
    for (let j = 1; j <= b.length; j++)
      next[j] =
        word === b[j - 1]
          ? previous[j - 1] + 1
          : Math.max(previous[j], next[j - 1]);
    previous = next;
  }
  return (2 * previous[b.length]) / (a.length + b.length);
}
export function wordErrorRate(reference, transcript) {
  const a = tokens(reference),
    b = tokens(transcript);
  if (!a.length) return b.length ? 1 : 0;
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const next = [i];
    for (let j = 1; j <= b.length; j++)
      next[j] = Math.min(
        previous[j] + 1,
        next[j - 1] + 1,
        previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    previous = next;
  }
  return previous[b.length] / a.length;
}
export function scoreAnswer(testCase, answer) {
  const text = String(answer || "").normalize("NFKC");
  const matches = (pattern) => new RegExp(pattern, "iu").test(text);
  function affirmativeClaim(pattern) {
    for (const match of text.matchAll(new RegExp(pattern, "giu"))) {
      const prefix =
        text
          .slice(Math.max(0, match.index - 60), match.index)
          .split(/[.!?;,\n]|\bbut\b/iu)
          .at(-1) || "";
      if (
        !/\b(?:no|not|never|cannot|without|unable|unclear|uncertain|whether)\b|\b\w+n['’]t\b/iu.test(
          prefix.slice(-40),
        )
      )
        return true;
    }
    return false;
  }
  const required = testCase.required_facts || [];
  const matchedFacts = required
    .filter(
      (fact) =>
        (fact.all || []).every(
          fact.negation_sensitive ? affirmativeClaim : matches,
        ) &&
        (!fact.any?.length ||
          fact.any.some(fact.negation_sensitive ? affirmativeClaim : matches)),
    )
    .map((fact) => fact.id);
  const missedFacts = required
    .filter((fact) => !matchedFacts.includes(fact.id))
    .map((fact) => fact.id);
  const contradictions = (testCase.forbidden_claims || [])
    .filter((fact) => fact.patterns.some(affirmativeClaim))
    .map((fact) => fact.id);
  const recall = required.length ? matchedFacts.length / required.length : 1;
  const precision =
    matchedFacts.length + contradictions.length
      ? matchedFacts.length / (matchedFacts.length + contradictions.length)
      : recall;
  return {
    matched_facts: matchedFacts,
    missed_facts: missedFacts,
    contradictions,
    fact_recall: recall,
    rubric_precision: precision,
    rubric_f1:
      precision + recall ? (2 * precision * recall) / (precision + recall) : 0,
    reference_overlap: referenceOverlap(testCase.expected_answer, text),
    pass:
      missedFacts.length === 0 &&
      contradictions.length === 0 &&
      text.trim().length > 0,
  };
}
export function percentile(values, p) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(p * sorted.length) - 1)];
}
export function summarize(results) {
  const groups = {};
  for (const channel of [...new Set(results.map((result) => result.channel))]) {
    const rows = results.filter((row) => row.channel === channel);
    const successful = rows.filter((row) => !row.error);
    const facts = rows.reduce(
      (n, row) =>
        n +
        (row.score?.matched_facts.length || 0) +
        (row.score?.missed_facts.length ?? row.required_fact_count ?? 0),
      0,
    );
    const matched = rows.reduce(
      (n, row) => n + (row.score?.matched_facts.length || 0),
      0,
    );
    const stepChecks = rows.filter(
      (row) => typeof row.checks?.step_selection === "boolean",
    );
    groups[channel] = {
      cases: rows.length,
      errors: rows.length - successful.length,
      passed: rows.filter(
        (row) =>
          row.score?.pass && Object.values(row.checks || {}).every(Boolean),
      ).length,
      fact_recall: facts ? matched / facts : 0,
      contradiction_free_rate:
        rows.filter(
          (row) => !row.error && row.score && !row.score.contradictions.length,
        ).length / rows.length,
      all_rules_pass_rate:
        rows.filter(
          (row) =>
            row.score?.pass && Object.values(row.checks || {}).every(Boolean),
        ).length / rows.length,
      step_selection_agreement: stepChecks.length
        ? stepChecks.filter((row) => row.checks.step_selection).length /
          stepChecks.length
        : null,
      latency_p50_ms: percentile(
        successful.map((row) => row.latency_ms),
        0.5,
      ),
      latency_p95_ms: percentile(
        successful.map((row) => row.latency_ms),
        0.95,
      ),
      first_token_p50_ms: percentile(
        successful.map((row) => row.first_token_ms).filter(Number.isFinite),
        0.5,
      ),
    };
  }
  return groups;
}
