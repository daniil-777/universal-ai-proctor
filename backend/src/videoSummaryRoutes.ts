import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { VideoSummaryModeSchema, VideoSummaryStartSchema } from "./domain/videoSummary.js";
import type { VideoSummaryJobs } from "./media/videoSummaryJobs.js";

const Params = z.object({ id: z.string().min(1).max(100) }).strict();
export function registerVideoSummaryRoutes(app: FastifyInstance, jobs: VideoSummaryJobs) {
  app.get("/api/video-summary/plan", async (request, reply) => {
    const query = z.object({ mode: VideoSummaryModeSchema.default("detailed") }).strict().parse(request.query);
    return reply.header("Cache-Control", "no-store").send({ ok: true, plan: jobs.plan(request.guidanceSession, query.mode) });
  });
  app.post("/api/video-summary/jobs", async (request, reply) => {
    const input = VideoSummaryStartSchema.parse(request.body);
    return reply.code(202).header("Cache-Control", "no-store").send({ ok: true, job: jobs.start(request.guidanceSession, input) });
  });
  app.get("/api/video-summary/jobs/current", async (request, reply) => reply.header("Cache-Control", "no-store").send({ ok: true, job: jobs.current(request.guidanceSession) }));
  app.get("/api/video-summary/jobs/:id", async (request, reply) => {
    const { id } = Params.parse(request.params);
    return reply.header("Cache-Control", "no-store").send({ ok: true, job: jobs.get(request.guidanceSession, id) });
  });
  app.post("/api/video-summary/jobs/:id/cancel", async (request, reply) => {
    const { id } = Params.parse(request.params);
    return reply.header("Cache-Control", "no-store").send({ ok: true, job: jobs.cancel(request.guidanceSession, id) });
  });
  app.post("/api/video-summary/jobs/:id/retry", async (request, reply) => {
    const { id } = Params.parse(request.params);
    return reply.code(202).header("Cache-Control", "no-store").send({ ok: true, job: jobs.retry(request.guidanceSession, id) });
  });
  app.get("/api/video-summary/jobs/:id/report.json", async (request, reply) => {
    const { id } = Params.parse(request.params);
    const job = jobs.get(request.guidanceSession, id);
    if (job.status !== "complete" && job.status !== "partial")
      return reply.code(409).send({ ok: false, error: "Finish the recap before downloading its JSON report." });
    return reply.header("Cache-Control", "no-store").header("Content-Disposition", `attachment; filename="cueveris-video-recap-${job.id}.json"`)
      .type("application/json; charset=utf-8").send(JSON.stringify(job, null, 2));
  });
}
