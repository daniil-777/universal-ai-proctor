import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createServer, type IncomingMessage } from "node:http";

// Set before dynamic imports so config cannot hydrate a private .env/provider.
for (const key of ["OPENAI_API_KEY", "ANTHROPIC_API_KEY", "GOOGLE_API_KEY", "HF_API_KEY", "QWEN_API_KEY", "LOCAL_LLM_MODEL"]) process.env[key] = "";
process.env.MOCK = "1";
const ownedDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "cueveris-report-qa-"));
process.env.UPLOAD_ROOT = path.join(ownedDirectory, "uploads");
const [{ createApp }, { GuidanceEngine }, { fixtureComplete }, { AccountStore }, { SessionStore }, { seedReportQa }, { structuredHandoff }] = await Promise.all([
  import("../backend/src/app.js"), import("../backend/src/pipeline/guidance.js"),
  import("../backend/tests/fixtures.js"), import("../backend/src/account/store.js"),
  import("../backend/src/domain/session.js"), import("./report-qa-data.mjs"),
  import("../backend/src/domain/review.js"),
]);
const store = new SessionStore();
const accountStore = new AccountStore({ file: ":memory:" });
const app = await createApp({ engine: new GuidanceEngine(fixtureComplete), store, accountStore });
function qaSession(request: IncomingMessage) {
  if (request.socket.remoteAddress !== "127.0.0.1") throw new Error("QA fixture is loopback-only");
  const id = request.headers["x-guidance-session"];
  if (typeof id !== "string" || !id || id.length > 120) throw new Error("QA session header required");
  return store.get(id);
}
// createApp returns an already-ready Fastify instance. Keep fixture-only routes
// in this loopback wrapper, then hand ordinary requests to its native routing.
const server = createServer((request, response) => {
  if (!request.url?.startsWith("/__report_qa/")) return app.routing(request, response);
  void (async () => {
    try {
      let result: unknown;
      if (request.url === "/__report_qa/seed" && request.method === "POST") {
        let body = "";
        for await (const chunk of request) {
          body += chunk.toString();
          if (body.length > 1024) throw new Error("QA body is too large");
        }
        const mode = (JSON.parse(body || "{}") as { mode?: string }).mode || "mixed";
        if (!["mixed", "unknown", "empty", "long", "paged"].includes(mode)) throw new Error("Unknown QA fixture");
        result = seedReportQa(qaSession(request), mode);
      } else if (request.url === "/__report_qa/snapshot" && request.method === "GET") result = structuredHandoff(qaSession(request));
      else throw new Error("Unknown QA route");
      response.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
      response.end(JSON.stringify(result));
    } catch (error) {
      response.writeHead(400, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ error: (error as Error).message }));
    }
  })();
});
const port = Number(process.env.REPORT_QA_PORT || 8113);
if (![8113, 8114].includes(port)) throw new Error("QA fixture uses isolated port 8113 or 8114");
await new Promise<void>(resolve => server.listen(port, "127.0.0.1", resolve));
console.log(`Isolated report QA fixture ready on http://127.0.0.1:${port}`);
let closing = false;
for (const signal of ["SIGINT", "SIGTERM"] as const) process.once(signal, () => {
  if (closing) return;
  closing = true;
  void new Promise<void>(resolve => server.close(() => resolve())).then(() => app.close()).then(() => { accountStore.close(); store.clear(); fs.rmSync(ownedDirectory, { recursive: true, force: true }); process.exit(0); });
});
