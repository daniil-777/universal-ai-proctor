import crypto from "node:crypto";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { appendException, appendReviewEvent, ensureReview, makeReviewThumbnail, REVIEW_LIMITS, reviewSnapshot, structuredHandoff, touchReview } from "./domain/review.js";

const Guard = z.object({
  source_id: z.string().min(1).max(100), reference_key: z.string().regex(/^[a-f0-9]{64}$/),
  review_version: z.number().int().nonnegative(),
});
const Operator = z.string().trim().max(120).optional();
const Job = z.object({ work_order: z.string().trim().max(200).optional(), asset: z.string().trim().max(200).optional(), operator: z.string().trim().max(120).optional() }).strict();

export function registerReviewRoutes(app: FastifyInstance, options: { thumbnail?: typeof makeReviewThumbnail } = {}) {
  app.get("/api/review", async (req, reply) => {
    const query = z.object({ include_images: z.enum(["true", "false"]).optional() }).strict().parse(req.query);
    const snapshot = reviewSnapshot(req.guidanceSession);
    if (query.include_images === "false") snapshot.events = snapshot.events.map(({ thumbnail_b64: _thumbnail, ...event }) => event);
    return reply.header("Cache-Control", "no-store").send(snapshot);
  });
  app.put("/api/review/readiness", async req => {
    const body = Guard.extend({ job: Job.optional(), checks: z.array(z.object({ id: z.string().max(80), checked: z.boolean() }).strict()).max(80).optional() }).strict().parse(req.body);
    const review = ensureReview(req.guidanceSession, body);
    if (body.checks) {
      const ids = new Set<string>();
      for (const check of body.checks) {
        if (ids.has(check.id) || !review.checks.some(item => item.id === check.id)) throw Object.assign(new Error("Unknown or duplicate preparation check."), { statusCode: 400 });
        ids.add(check.id);
      }
    }
    const operator = body.job?.operator || review.job.operator || "Operator";
    if (body.job) review.job = { ...review.job, ...body.job };
    for (const patch of body.checks || []) {
      const check = review.checks.find(item => item.id === patch.id)!;
      if (check.checked !== patch.checked) {
        check.checked = patch.checked;
        if (patch.checked) { check.checked_at = Date.now(); check.checked_by = operator; }
        else { delete check.checked_at; delete check.checked_by; }
      }
    }
    touchReview(review);
    return reviewSnapshot(req.guidanceSession);
  });
  app.post("/api/review/bookmarks", async (req, reply) => {
    const body = Guard.extend({ current_s: z.number().finite().min(0).max(864000), frame_b64: z.string().min(1).max(1_200_000), note: z.string().trim().max(2000).optional(), operator_label: Operator }).strict().parse(req.body);
    const s = req.guidanceSession;
    ensureReview(s, body);
    if (s.sourceKind === "video" && s.videoInfo && body.current_s > s.videoInfo.duration + 0.1)
      throw Object.assign(new Error("Bookmark time is outside this video."), { statusCode: 400 });
    const occurredAt = Date.now();
    const controller = new AbortController();
    const abort = () => controller.abort();
    req.raw.once("aborted", abort); reply.raw.once("close", abort);
    try {
      const thumbnail = await (options.thumbnail || makeReviewThumbnail)(body.frame_b64);
      controller.signal.throwIfAborted();
      const review = ensureReview(s, body);
      appendReviewEvent(review, { id: crypto.randomUUID(), source_id: s.sourceId, reference_key: review.reference_key, kind: "bookmark", provenance: "operator", occurred_at: occurredAt, video_time_s: body.current_s, summary: body.note || "Operator bookmark", guidance: "", concern: "", status: "ok", step_ids: [], thumbnail_b64: thumbnail, operator: body.operator_label || review.job.operator || "Operator" });
      return reviewSnapshot(s);
    } finally { req.raw.off("aborted", abort); reply.raw.off("close", abort); }
  });
  app.post("/api/review/exceptions", async req => {
    const body = Guard.extend({ title: z.string().trim().min(1).max(300), description: z.string().trim().max(2000).optional(), event_id: z.string().max(100).optional(), operator_label: Operator }).strict().parse(req.body);
    const review = ensureReview(req.guidanceSession, body);
    const event = body.event_id ? review.events.find(item => item.id === body.event_id) : undefined;
    if (body.event_id && !event) throw Object.assign(new Error("Evidence event is no longer available."), { statusCode: 404 });
    const at = Date.now();
    appendException(review, { id: crypto.randomUUID(), title: body.title, description: body.description || "", event_id: body.event_id, reference_key: event?.reference_key || review.reference_key, provenance: "operator", status: "open", created_at: at, updated_at: at, history: [{ status: "open", note: body.description || "Raised by the operator.", at, operator: body.operator_label || review.job.operator || "Operator" }] });
    return reviewSnapshot(req.guidanceSession);
  });
  app.patch("/api/review/exceptions/:id", async req => {
    const body = Guard.extend({ status: z.enum(["open", "acknowledged", "resolved"]), note: z.string().trim().max(1000).optional(), operator_label: Operator }).strict().parse(req.body);
    if (body.status === "resolved" && !body.note) throw Object.assign(new Error("Add a resolution note before resolving this exception."), { statusCode: 400 });
    const review = ensureReview(req.guidanceSession, body);
    const { id } = z.object({ id: z.string().max(100) }).parse(req.params);
    const issue = review.exceptions.find(item => item.id === id);
    if (!issue) throw Object.assign(new Error("Exception not found."), { statusCode: 404 });
    if (issue.status !== body.status || body.note) {
      issue.status = body.status; issue.updated_at = Date.now();
      issue.history.push({ status: body.status, note: body.note || (body.status === "open" ? "Reopened for review." : "Acknowledged for review."), at: issue.updated_at, operator: body.operator_label || review.job.operator || "Operator" });
      if (issue.history.length > REVIEW_LIMITS.history) {
        issue.history_omitted = (issue.history_omitted || 0) + issue.history.length - REVIEW_LIMITS.history;
        issue.history = [issue.history[0], ...issue.history.slice(-(REVIEW_LIMITS.history - 1))];
      }
      touchReview(review);
    }
    return reviewSnapshot(req.guidanceSession);
  });
  app.get("/api/review/handoff", async (req, reply) => reply.header("Cache-Control", "no-store").header("Content-Disposition", "attachment; filename=process-guide-handoff.json").send(structuredHandoff(req.guidanceSession)));
  for (const format of ["pdf", "html"] as const) {
    app.get(`/api/review/report.${format}`, async (req, reply) => {
      const query = Guard.extend({ review_version: z.coerce.number().int().nonnegative(), revision: z.coerce.number().int().nonnegative().optional(), preferences_revision: z.coerce.number().int().nonnegative().optional() }).partial().strict().parse(req.query);
      const supplied = Object.keys(query).length > 0;
      if (supplied && [query.source_id, query.reference_key, query.review_version].some(value => value === undefined)) throw Object.assign(new Error("Include source_id, reference_key and review_version together."), { statusCode: 400 });
      const s = req.guidanceSession;
      const review = reviewSnapshot(s);
      const guard = supplied ? Guard.parse(query) : { source_id: review.source_id, reference_key: review.reference_key, review_version: review.review_version };
      ensureReview(s, guard);
      if ((query.revision !== undefined && query.revision !== s.revision) || (query.preferences_revision !== undefined && query.preferences_revision !== (s.preferencesRevision || 0)))
        throw Object.assign(new Error("Progress or guidance goals changed. Prepare a fresh report."), { statusCode: 409 });
      const snapshot = structuredHandoff(s);
      const controller = new AbortController();
      const abort = () => controller.abort();
      req.raw.once("aborted", abort); reply.raw.once("close", abort);
      try {
        const renderer = await import("./media/analysisReport.js");
        const report = format === "pdf" ? await renderer.renderAnalysisPdf(snapshot, controller.signal) : renderer.renderAnalysisHtml(snapshot);
        controller.signal.throwIfAborted();
        ensureReview(s, guard);
        if (s.revision !== snapshot.session_revision || (s.preferencesRevision || 0) !== snapshot.preferences_revision)
          throw Object.assign(new Error("Progress or guidance goals changed while preparing the report."), { statusCode: 409 });
        return reply.header("Cache-Control", "no-store").header("Content-Disposition", `attachment; filename=process-guide-analysis.${format}`).type(format === "pdf" ? "application/pdf" : "text/html; charset=utf-8").send(report);
      } finally { req.raw.off("aborted", abort); reply.raw.off("close", abort); }
    });
  }
}
