import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createServer, type IncomingMessage } from "node:http";
import { abortableDelay, initialSummaryQaControl, SUMMARY_QA_MODES, summaryQaComplete, summaryQaWav, type SummaryQaCall, type SummaryQaSpeech } from "./video-summary-qa-data.mjs";

// Prevent config from hydrating provider credentials from an existing .env.
for (const key of ["OPENAI_API_KEY", "ANTHROPIC_API_KEY", "GOOGLE_API_KEY", "HF_API_KEY", "QWEN_API_KEY", "LOCAL_LLM_MODEL"]) process.env[key] = "";
process.env.MOCK = "1";
const ownedDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "cueveris-video-summary-qa-"));
process.env.UPLOAD_ROOT = path.join(ownedDirectory, "uploads");
const [{ createApp }, { GuidanceEngine }, { fixtureComplete }, { AccountStore }, { SessionStore }, { VideoSummaryJobs }, { DomainKeySchema }] = await Promise.all([
  import("../backend/src/app.js"), import("../backend/src/pipeline/guidance.js"), import("../backend/tests/fixtures.js"),
  import("../backend/src/account/store.js"), import("../backend/src/domain/session.js"), import("../backend/src/media/videoSummaryJobs.js"),
  import("../backend/src/domain/videoSummary.js"),
]);
let control = initialSummaryQaControl();
const calls: SummaryQaCall[] = [], speech: SummaryQaSpeech[] = [];
let interactiveCalls = 0;
const store = new SessionStore(), accountStore = new AccountStore({ file: ":memory:" });
const summaryJobs = new VideoSummaryJobs({ complete: summaryQaComplete(() => control, calls), allowMockForTests: true,
  readAudio: async input => control.mode === "meeting_audio"
    ? { status: "available", segments: [{ id: "qa-transcript", start_s: input.start_s + 0.5, end_s: Math.min(input.end_s, input.start_s + 1.5), text: `Simulated QA speech: a decision to review generated pattern window ${Math.floor(input.start_s / 6) + 1}.` }], note: "Explicitly injected synthetic transcript for isolated transport QA; not transcribed from this silent clip." }
    : { status: "no_audio", segments: [], note: "The generated silent QA clip has no speech track; no transcript has been invented." },
});
const app = await createApp({ engine: new GuidanceEngine(async input => { interactiveCalls++; return fixtureComplete(input); }), store, accountStore, summaryJobs });
function qaSession(request: IncomingMessage) {
  if (request.socket.remoteAddress !== "127.0.0.1") throw new Error("QA fixture is loopback-only");
  const header = request.headers["x-guidance-session"];
  const id = typeof header === "string" ? header : /(?:^|;\s*)guidance-session=([^;]+)/.exec(request.headers.cookie || "")?.[1];
  if (!id || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) throw new Error("Valid QA session header required");
  return store.get(id);
}
async function body(request: IncomingMessage, limit = 4096) {
  let text = "";
  for await (const chunk of request) { text += chunk.toString(); if (Buffer.byteLength(text) > limit) throw new Error("QA body is too large"); }
  return JSON.parse(text || "{}") as Record<string, unknown>;
}
const pendingSpeech = new Set<AbortController>();
// No QA route is installed on Fastify or imported by the production entrypoint.
// This wrapper owns only loopback controls and the explicitly simulated TTS tone.
const server = createServer((request, response) => {
  const fixtureRoute = request.url?.startsWith("/__video_summary_qa/");
  const fixtureSpeech = request.url === "/api/tts" && request.method === "POST";
  if (!fixtureRoute && !fixtureSpeech) return app.routing(request, response);
  void (async () => {
    try {
      const session = qaSession(request);
      if (fixtureSpeech) {
        const input = await body(request, 16000);
        if (typeof input.text !== "string" || !input.text.trim()) throw new Error("QA TTS text required");
        const record: SummaryQaSpeech = { text: input.text, at: Date.now(), sent: false, cancelled: false };
        speech.push(record);
        const controller = new AbortController(); pendingSpeech.add(controller);
        response.once("close", () => { if (!response.writableEnded) { record.cancelled = true; controller.abort(); } });
        try { await abortableDelay(control.tts_delay_ms, controller.signal); }
        finally { pendingSpeech.delete(controller); }
        const audio = summaryQaWav(); record.sent = true;
        response.writeHead(200, { "Content-Type": "audio/wav", "Content-Length": audio.length, "Cache-Control": "no-store", "X-QA-Simulated": "1" });
        response.end(audio); return;
      }
      let result: unknown;
      if (request.url === "/__video_summary_qa/control" && request.method === "POST") {
        const input = await body(request);
        if (input.mode !== undefined && !SUMMARY_QA_MODES.includes(input.mode as typeof SUMMARY_QA_MODES[number])) throw new Error("Unknown QA mode");
        if (input.domain !== undefined) DomainKeySchema.parse(input.domain);
        for (const key of ["delay_ms", "tts_delay_ms"] as const) if (input[key] !== undefined && (typeof input[key] !== "number" || !Number.isInteger(input[key]) || input[key] < 0 || input[key] > 5000)) throw new Error("QA delays must be integer milliseconds within 0–5000");
        control = { ...control, ...input } as typeof control;
        if (input.clear_audit === true) { calls.length = 0; speech.length = 0; interactiveCalls = 0; }
        result = { simulated: true, control };
      } else if (request.url === "/__video_summary_qa/audit" && request.method === "GET") result = {
        simulated: true, control, calls, speech, interactive_calls: interactiveCalls,
        input: { source_id: session.sourceId, media_generation: session.mediaGeneration, reference_chars: session.text.length, workflow: session.workflow, votes: [...session.votes] },
        real_provider_calls: 0,
      };
      else throw new Error("Unknown QA route");
      response.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" }); response.end(JSON.stringify(result));
    } catch (error) {
      if (response.destroyed || response.writableEnded) return;
      response.writeHead(400, { "Content-Type": "application/json" }); response.end(JSON.stringify({ error: (error as Error).message }));
    }
  })();
});
const port = Number(process.env.VIDEO_SUMMARY_QA_PORT || 8115);
if (![8115, 8116].includes(port)) throw new Error("Video summary QA uses isolated port 8115 or 8116");
await new Promise<void>(resolve => server.listen(port, "127.0.0.1", resolve));
console.log(`Simulated video recap QA ready on http://127.0.0.1:${port}; real providers disconnected`);
let closing = false;
for (const signal of ["SIGINT", "SIGTERM"] as const) process.once(signal, () => {
  if (closing) return; closing = true;
  for (const controller of pendingSpeech) controller.abort();
  void new Promise<void>(resolve => server.close(() => resolve())).then(() => app.close()).then(() => summaryJobs.close()).then(() => {
    accountStore.close(); store.clear(); fs.rmSync(ownedDirectory, { recursive: true, force: true }); process.exit(0);
  });
});
