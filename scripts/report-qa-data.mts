import { parseDocument } from "../backend/src/domain/guidance.js";
import { syncReview, touchReview, structuredHandoff, type ReviewEvent } from "../backend/src/domain/review.js";
import type { Session } from "../backend/src/domain/session.js";

export const reportQaDocument = [
  "Step 1: Prepare", "Objective: Keep the component available for review.",
  "Tools: Gauge", "Actions: Place the component on the table.",
  "Criteria: Component visibly present; Measurement still requires evidence.",
  "Step 2: Inspect", "Actions: Inspect the assembly.",
  "Criteria: Alignment recorded; Label partly visible.",
  "Step 3: Finish", "Actions: Review the finished component.",
  "Criteria: Final result documented.",
  "Principles: Review retained samples without treating gaps as process coverage.",
].join("\n");

/** Synthetic records for isolated QA; no claims about a real process or operator. */
export function seedReportQa(session: Session, mode = "mixed") {
  session.filename = "Report integrity fixture.txt";
  session.text = reportQaDocument;
  if (mode === "long") {
    session.filename = `Reference ${"LongName".repeat(27)} FULL_IDENTITY_END_6789.txt`;
    session.text = session.text.replace("Step 2: Inspect", `Step 2: Inspect ${"UnbrokenName".repeat(22)} STEP_NAME_END_6789`)
      .replace("Alignment recorded", `Alignment ${"UnbrokenCriterion".repeat(26)} CRITERION_END_6789`);
  }
  session.rows = parseDocument(session.filename, session.text).rows;
  session.workflow = parseDocument(session.filename, session.text).workflow;
  session.sourceName = "Synthetic report review clip";
  // The browser reloads this uploaded clip at its beginning. Replace the
  // reference's runtime history too, as the normal document API does, so a
  // backward seek cannot restore observations from the pre-seed definition.
  session.lastTime = 0;
  session.votes.clear();
  session.cache.clear();
  session.inflight.clear();
  session.snapshots = [];
  session.observations = [];
  if (!session.sourceId) session.sourceId = "report-qa-source";
  session.sourceKind = "video";
  session.videoInfo = { duration: 60, fps: 12, width: 640, height: 360 };
  if (mode === "unknown") session.videoInfo = undefined;
  session.revision++;
  const review = syncReview(session);
  review.events = [];
  review.exceptions = [];
  review.dropped_events = 3;
  review.dropped_thumbnails = 2;
  review.dropped_exceptions = 1;
  review.job = { work_order: "QA-WO-001", asset: "Synthetic component", operator: "QA operator" };
  const first = session.workflow.steps[0]!;
  first.complete = true;
  first.confirmation = "manual";
  first.progress = 100;
  first.criteria[0]!.status = "met";
  first.criteria[0]!.evidence = "Operator record: Größe geprüft. Проверено. Ελληνικά. → ✔";
  session.workflow.steps[1]!.criteria[0]!.status = "not_met";
  session.workflow.steps[1]!.criteria[1]!.status = "partial";
  session.currentId = session.workflow.steps[1]!.id;
  const event = (id: string, order: number, time: number, extra: Partial<ReviewEvent> = {}): ReviewEvent => ({
    id, source_id: session.sourceId, reference_key: review.reference_key,
    kind: "observation", provenance: "ai", occurred_at: 1760000000000 + order,
    video_time_s: time, summary: id, guidance: "Synthetic QA evidence; retain uncertainty.",
    concern: "", status: "watch", step_ids: ["S2"], observation_scope: "current", ...extra,
  });
  // Shuffled storage order deliberately tests stable references before filters.
  review.events = [
    event("current-alignment", 2, 6, { status: "alert", concern: "Alignment needs review" }),
    event("earlier-reused-S1", 1, 4, { reference_key: "earlier-reference", step_ids: ["S1"] }),
    event("whole-video-overview", 5, 20, { observation_scope: "overview" }),
    event("operator-bookmark", 3, 30, { kind: "bookmark", provenance: "operator", status: "ok", step_ids: ["S1"] }),
    event("demo-observation", 4, 15, { simulated: true, step_ids: ["S3"] }),
    event("outside-source-duration", 6, 90),
    event("orphan-step-record", 7, 12, { step_ids: ["S404"] }),
  ];
  const issue = (id: string, title: string, linked?: string, earlier = false) => ({
    id, title, description: `${title}: synthetic review decision`, event_id: linked,
    reference_key: earlier ? "earlier-reference" : review.reference_key,
    provenance: "operator" as const, status: "open" as const,
    created_at: 1760000000000, updated_at: 1760000000001,
    history: [{ status: "open" as const, at: 1760000000000, note: "Keep the criterion unverified.", operator: "QA reviewer" }],
  });
  review.exceptions = [
    issue("current-issue", "Current alignment issue", "current-alignment"),
    issue("earlier-issue", "Earlier guidance issue", "earlier-reused-S1", true),
    issue("orphan-issue", "Retained issue with missing event", "retention-removed-event"),
    issue("unlinked-issue", "Independent operator issue"),
  ];
  if (mode === "paged") {
    review.events.push(...Array.from({ length: 16 }, (_, index) => event(`later-overview-${index + 1}`, 10 + index, 20, { observation_scope: "overview" })));
  }
  if (mode === "empty") {
    session.workflow.steps = [];
    session.workflow.source = "none";
    session.workflow.title = "Empty report fixture";
    review.events = []; review.exceptions = []; review.checks = [];
    review.dropped_events = review.dropped_thumbnails = review.dropped_exceptions = 0;
  }
  if (mode === "long") {
    const suffix = "FULL_IDENTITY_END_6789";
    session.sourceName = `Synthetic source ${"LongName".repeat(27)} ${suffix}`;
    session.workflow.title = `Fixture ${"LongName".repeat(27)} ${suffix}`;
    review.job.operator = `QA ${"LongOperator".repeat(20)} OPERATOR_END_6789`;
    review.events[0]!.summary += ` ${"LongNote".repeat(80)} EVIDENCE_NOTE_END_6789`;
  }
  session.currentId = session.workflow.steps.find(step => !step.complete)?.id
    || session.workflow.steps.at(-1)?.id || "";
  // Fixture confirmations are baseline records, available at playback zero.
  // Keep a detached snapshot so subsequent observation/seek tests retain that
  // baseline without sharing mutable workflow objects.
  session.snapshots = [{ time: 0, workflow: structuredClone(session.workflow), votes: new Map() }];
  touchReview(review);
  return structuredHandoff(session);
}
