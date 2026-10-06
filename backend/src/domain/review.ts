import crypto from "node:crypto";
import sharp from "sharp";
import type { Observation, Workflow } from "./guidance.js";
import type { Session } from "./session.js";

export const REVIEW_LIMITS = Object.freeze({ events: 150, thumbnails: 24, thumbnail_bytes: 512 * 1024, exceptions: 80, history: 20 });
export const REVIEW_NOTICE = "Operator preparation checks and AI observations are review aids, not safety certification. Acknowledging or resolving an exception does not confirm workflow criteria.";
export type ReviewStatus = "open" | "acknowledged" | "resolved";
export interface ReviewCheck { id: string; label: string; kind: "tool" | "principle"; checked: boolean; checked_at?: number; checked_by?: string }
export interface ReviewEvent {
  id: string; source_id: string; reference_key: string; kind: "observation" | "milestone" | "bookmark";
  provenance: "ai" | "operator" | "system"; occurred_at: number; video_time_s: number;
  summary: string; guidance: string; concern: string; status: "ok" | "watch" | "alert";
  step_ids: string[]; thumbnail_b64?: string; operator?: string; model?: string; simulated?: boolean;
  observation_scope?: "current" | "overview";
}
export interface ReviewException {
  id: string; title: string; description: string; event_id?: string; reference_key: string;
  provenance: "ai" | "operator" | "system"; status: ReviewStatus; created_at: number; updated_at: number;
  history: Array<{ status: ReviewStatus; note: string; at: number; operator: string }>;
  history_omitted?: number;
}
export interface ReviewState {
  source_id: string; reference_key: string; version: number; updated_at: number;
  job: { work_order: string; asset: string; operator: string }; checks: ReviewCheck[];
  events: ReviewEvent[]; exceptions: ReviewException[];
  dropped_events: number; dropped_thumbnails: number; dropped_exceptions: number;
}
export interface ReviewGuard { source_id: string; reference_key: string; review_version: number }

// Completion, votes, seek revisions and file names are deliberately excluded.
export function referenceKey(s: Pick<Session, "text" | "rows" | "workflow">): string {
  return crypto.createHash("sha256").update(JSON.stringify({ text: s.text.replace(/\r\n/g, "\n"), rows: s.rows, principles: s.workflow.principles })).digest("hex");
}
function suggestedChecks(workflow: Workflow): ReviewCheck[] {
  const items = [
    ...workflow.principles.map(label => ({ label, kind: "principle" as const })),
    ...workflow.steps.flatMap(step => step.expectedInstruments).map(label => ({ label, kind: "tool" as const })),
  ];
  const seen = new Set<string>();
  return items.filter(item => {
    const key = `${item.kind}:${item.label.trim().toLocaleLowerCase()}`;
    if (!item.label.trim() || seen.has(key)) return false;
    seen.add(key); return true;
  }).slice(0, 80).sort((a, b) => a.kind === b.kind ? 0 : a.kind === "tool" ? -1 : 1).map(item => ({
    id: crypto.createHash("sha256").update(`${item.kind}:${item.label}`).digest("hex").slice(0, 20),
    label: item.label.slice(0, 2000), kind: item.kind, checked: false,
  }));
}
export function syncReview(s: Session): ReviewState {
  const reference_key = referenceKey(s);
  if (!s.review || s.review.source_id !== s.sourceId) {
    const version = (s.review?.version ?? -1) + 1;
    s.review = { source_id: s.sourceId, reference_key, version, updated_at: Date.now(), job: { work_order: "", asset: "", operator: "" }, checks: suggestedChecks(s.workflow), events: [], exceptions: [], dropped_events: 0, dropped_thumbnails: 0, dropped_exceptions: 0 };
  } else if (s.review.reference_key !== reference_key) {
    s.review.reference_key = reference_key;
    s.review.checks = suggestedChecks(s.workflow);
    touchReview(s.review);
  }
  return s.review;
}
export function touchReview(review: ReviewState) { review.version++; review.updated_at = Date.now(); }
export function ensureReview(s: Session, guard: ReviewGuard): ReviewState {
  const review = syncReview(s);
  if (s.disposed || guard.source_id !== s.sourceId || guard.reference_key !== review.reference_key || guard.review_version !== review.version)
    throw Object.assign(new Error("Input, reference or review changed. Refresh the review and retry."), { statusCode: 409 });
  if (!s.sourceId) throw Object.assign(new Error("Load a video or connect a camera first."), { statusCode: 400 });
  return review;
}
export function reviewSnapshot(s: Session) {
  const review = syncReview(s);
  const duration = s.sourceKind === "video" ? s.videoInfo?.duration : undefined;
  return {
    ok: true, source_id: review.source_id, reference_key: review.reference_key, review_version: review.version,
    source_duration_s: typeof duration === "number" && Number.isFinite(duration) && duration > 0 ? duration : null,
    job: { ...review.job }, checks: review.checks.map(check => ({ ...check })),
    events: review.events.map(event => ({ ...event, step_ids: [...event.step_ids], thumbnail_available: !!event.thumbnail_b64, old_reference: event.reference_key !== review.reference_key })),
    exceptions: review.exceptions.map(issue => ({ ...issue, history: issue.history.map(item => ({ ...item })), old_reference: issue.reference_key !== review.reference_key })),
    retention: { ...REVIEW_LIMITS, retained_events: review.events.length, retained_thumbnails: review.events.filter(event => event.thumbnail_b64).length, retained_thumbnail_bytes: thumbnailBytes(review), dropped_events: review.dropped_events, dropped_thumbnails: review.dropped_thumbnails, dropped_exceptions: review.dropped_exceptions },
    notice: REVIEW_NOTICE,
  };
}
function thumbnailBytes(review: ReviewState) { return review.events.reduce((sum, event) => sum + (event.thumbnail_b64 ? Buffer.byteLength(event.thumbnail_b64) : 0), 0); }
export function appendReviewEvent(review: ReviewState, event: ReviewEvent) {
  review.events.push(event);
  while (review.events.length > REVIEW_LIMITS.events || Buffer.byteLength(JSON.stringify(review.events.map(({ thumbnail_b64: _thumbnail, ...metadata }) => metadata))) > 512 * 1024) {
    review.events.shift(); review.dropped_events++;
  }
  while (review.events.filter(item => item.thumbnail_b64).length > REVIEW_LIMITS.thumbnails || thumbnailBytes(review) > REVIEW_LIMITS.thumbnail_bytes) {
    const oldest = review.events.find(item => item.thumbnail_b64);
    if (!oldest) break;
    delete oldest.thumbnail_b64; review.dropped_thumbnails++;
  }
  touchReview(review);
}
export function appendException(review: ReviewState, issue: ReviewException, automatic = false) {
  if (review.exceptions.length >= REVIEW_LIMITS.exceptions) {
    const oldestResolved = review.exceptions.findIndex(item => item.status === "resolved");
    if (oldestResolved < 0) {
      if (automatic) { review.dropped_exceptions++; return; }
      throw Object.assign(new Error("The exception desk is full. Resolve an existing issue before raising another."), { statusCode: 429 });
    }
    review.exceptions.splice(oldestResolved, 1); review.dropped_exceptions++;
  }
  review.exceptions.push(issue); touchReview(review);
}
export async function makeReviewThumbnail(input: string | Buffer): Promise<string> {
  let raw: Buffer;
  if (typeof input === "string") {
    const value = input.replace(/^data:image\/(?:jpeg|jpg|png|webp);base64,/, "");
    if (!/^[A-Za-z0-9+/]+={0,2}$/.test(value) || value.length > 1_200_000)
      throw Object.assign(new Error("Use a valid JPEG, PNG or WebP evidence frame."), { statusCode: 400 });
    raw = Buffer.from(value, "base64");
  } else raw = input;
  try {
    const metadata = await sharp(raw, { limitInputPixels: 20_000_000 }).metadata();
    if (!metadata.format || !["jpeg", "png", "webp"].includes(metadata.format)) throw new Error("Unsupported image");
    let image = await sharp(raw, { limitInputPixels: 20_000_000 }).rotate().resize({ width: 480, height: 320, fit: "inside", withoutEnlargement: true }).jpeg({ quality: 65 }).toBuffer();
    if (image.length > 36 * 1024) image = await sharp(image).resize({ width: 320, height: 220, fit: "inside" }).jpeg({ quality: 45 }).toBuffer();
    if (image.length > 36 * 1024) throw new Error("Evidence image exceeds the thumbnail budget");
    return `data:image/jpeg;base64,${image.toString("base64")}`;
  } catch {
    throw Object.assign(new Error("Invalid or oversized evidence image."), { statusCode: 400 });
  }
}
function normalizedConcern(observation: Observation) { return (observation.concern || observation.guidance).trim().replace(/\s+/g, " ").toLocaleLowerCase(); }
export function hasNewConcern(s: Session, observation: Observation): boolean {
  if (observation.status === "ok") return false;
  const key = normalizedConcern(observation);
  return !!key && !syncReview(s).exceptions.some(issue => issue.reference_key === referenceKey(s) && issue.status !== "resolved" && issue.description.toLocaleLowerCase() === key);
}
export function captureObservationReview(s: Session, observation: Observation, input: { time: number; milestones: string[]; thumbnail?: string; model?: string; simulated?: boolean; occurredAt: number; system?: boolean; overview?: boolean }) {
  const review = syncReview(s);
  const event: ReviewEvent = {
    id: crypto.randomUUID(), source_id: s.sourceId, reference_key: review.reference_key,
    kind: input.milestones.length ? "milestone" : "observation", provenance: input.system || input.simulated ? "system" : "ai", occurred_at: input.occurredAt,
    video_time_s: input.time, summary: observation.summary.slice(0, 2000), guidance: observation.guidance.slice(0, 2000),
    concern: observation.concern.slice(0, 2000), status: observation.status, step_ids: [...input.milestones], thumbnail_b64: input.thumbnail,
    model: input.system || input.simulated ? undefined : input.model, simulated: input.simulated, observation_scope: input.overview ? "overview" : "current",
  };
  const newConcern = !input.simulated && !input.overview && hasNewConcern(s, observation);
  appendReviewEvent(review, event);
  if (newConcern) {
    const description = (observation.concern || observation.guidance).trim().replace(/\s+/g, " ").slice(0, 2000);
    appendException(review, { id: crypto.randomUUID(), title: description.slice(0, 180), description, event_id: event.id, reference_key: review.reference_key, provenance: event.provenance, status: "open", created_at: input.occurredAt, updated_at: input.occurredAt, history: [{ status: "open", note: input.system ? "Raised by the image-quality check; requires operator review." : "Raised from an AI observation; requires operator review.", at: input.occurredAt, operator: input.system ? "Image-quality check" : "AI observation" }] }, true);
  }
  return event;
}
export function structuredHandoff(s: Session) {
  const review = reviewSnapshot(s);
  return {
    schema_version: "1.0", generated_at: new Date().toISOString(), session_revision: s.revision, preferences_revision: s.preferencesRevision || 0, source: { id: s.sourceId, kind: s.sourceKind || "unknown", name: s.sourceName || "", current_time_s: s.lastTime, duration_s: s.videoInfo?.duration ?? null },
    reference: { filename: s.filename, reference_key: review.reference_key, workflow_source: s.workflow.source, title: s.workflow.title, principles: [...s.workflow.principles], warnings: [...s.workflow.warnings] },
    operator_goals: s.operatorGoals || "", job: review.job, operator_checks: review.checks,
    progress: s.workflow.steps.map(step => ({ id: step.id, name: step.name, description: step.description, objective: step.objective, actions: [...step.actions], expected_instruments: [...step.expectedInstruments], complete: step.complete, progress: step.progress, confirmation: step.confirmation || null, criteria: step.criteria.map(criterion => ({ key: criterion.key, label: criterion.label, status: criterion.status, evidence: criterion.evidence || "", confirmed_at_s: criterion.confirmedAt ?? null })) })),
    unresolved_criteria: s.workflow.steps.flatMap(step => step.criteria.filter(criterion => criterion.status !== "met").map(criterion => ({ step_id: step.id, step_name: step.name, key: criterion.key, label: criterion.label, status: criterion.status }))),
    open_exceptions: review.exceptions.filter(issue => issue.status !== "resolved"), exception_history: review.exceptions,
    evidence: review.events, review_version: review.review_version, retention: review.retention, notice: REVIEW_NOTICE,
  };
}
export type StructuredHandoff = ReturnType<typeof structuredHandoff>;
