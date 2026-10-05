import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { ensureReview, structuredHandoff } from "../domain/review.js";
import type { Session } from "../domain/session.js";
import { hashPassword, verifyPassword } from "./password.js";
import { AccountStore, publicUser } from "./store.js";
import { renderAnalysisHtml, renderAnalysisPdf } from "../media/analysisReport.js";

const COOKIE = "process-guide-account";
const failure = (message: string, statusCode: number) => Object.assign(new Error(message), { statusCode });
const email = z.string().trim().toLowerCase().email().max(254);
const credentials = z.object({ email, password: z.string().min(12).max(128) }).strict();
export interface AccountRouteOptions {
  getGuidanceSession: (request: FastifyRequest) => Session;
  store?: AccountStore; publicOrigin?: string; secureCookies?: boolean;
  limits?: { loginIp?: number; loginEmail?: number; registerIp?: number };
  renderPdf?: typeof renderAnalysisPdf;
}
export function registerAccountRoutes(app: FastifyInstance, options: AccountRouteOptions) {
  const store = options.store || new AccountStore();
  const publicOrigin = options.publicOrigin || process.env.ACCOUNT_PUBLIC_ORIGIN || "";
  if (publicOrigin && new URL(publicOrigin).origin !== publicOrigin) throw new Error("ACCOUNT_PUBLIC_ORIGIN must be an origin such as https://guide.example.com");
  const secure = options.secureCookies ?? (process.env.ACCOUNT_COOKIE_SECURE === "true" || (process.env.ACCOUNT_COOKIE_SECURE !== "false" && (process.env.NODE_ENV === "production" || publicOrigin.startsWith("https://"))));
  const deployment = publicOrigin && !["localhost", "127.0.0.1", "[::1]"].includes(new URL(publicOrigin).hostname) ? "hosted" : "local";
  let activePdfRenders = 0;
  const token = (request: FastifyRequest) => {
    const matches = (request.headers.cookie || "").split(";").map(value => value.trim()).filter(value => value.startsWith(`${COOKIE}=`));
    return matches.length === 1 ? matches[0]!.slice(COOKIE.length + 1) : undefined;
  };
  const cookie = (reply: FastifyReply, value: string, expire = false) => {
    const existing = reply.getHeader("set-cookie");
    const values = existing ? (Array.isArray(existing) ? existing.map(String) : [String(existing)]) : [];
    reply.header("Set-Cookie", [...values, `${COOKIE}=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${expire ? 0 : Math.floor(store.sessionTtlMs / 1000)}${secure ? "; Secure" : ""}`]);
  };
  const sameOrigin = (request: FastifyRequest) => {
    const expected = publicOrigin || `${request.protocol}://${request.headers.host || ""}`;
    if (request.headers.origin !== expected || (request.headers["sec-fetch-site"] && !["same-origin", "none"].includes(String(request.headers["sec-fetch-site"])))) throw failure("Account changes must come from this app's origin.", 403);
  };
  const authenticate = (request: FastifyRequest) => {
    const user = store.userForToken(token(request));
    if (!user) throw failure("Sign in to view or save training activity.", 401);
    return user;
  };
  const limited = (request: FastifyRequest, kind: "login" | "register", userEmail: string) => {
    const ipLimit = kind === "login" ? options.limits?.loginIp ?? 30 : options.limits?.registerIp ?? 10;
    if (!store.consumeLimit(`${kind}:ip:${request.ip}`, ipLimit, kind === "login" ? 10 * 60_000 : 60 * 60_000) ||
      (kind === "login" && !store.consumeLimit(`login:email:${userEmail}`, options.limits?.loginEmail ?? 10, 15 * 60_000))) throw failure("Too many sign-in attempts. Please try again later.", 429);
  };
  app.addHook("onSend", async (request, reply, payload) => {
    if (request.url.startsWith("/api/account/")) reply.header("Cache-Control", "no-store");
    return payload;
  });
  if (!options.store) app.addHook("onClose", async () => store.close());
  app.get("/api/account/me", async request => ({ ok: true, user: store.userForToken(token(request)) || null, storage: "server", deployment }));
  app.post("/api/account/register", async (request, reply) => {
    sameOrigin(request);
    const body = credentials.extend({ name: z.string().trim().min(1).max(80) }).parse(request.body);
    limited(request, "register", body.email);
    const passwordHash = await hashPassword(body.password);
    const user = store.createUser(body.email, body.name, passwordHash);
    cookie(reply, store.rotateSession(user.id, token(request)));
    return { ok: true, user, storage: "server", deployment };
  });
  app.post("/api/account/login", async (request, reply) => {
    sameOrigin(request); const body = credentials.parse(request.body);
    limited(request, "login", body.email);
    const record = store.getUserByEmail(body.email);
    const verified = await verifyPassword(body.password, record?.password_hash);
    if (!record || !verified) throw failure("Email or password is incorrect.", 401);
    const user = publicUser(record);
    cookie(reply, store.rotateSession(user.id, token(request)));
    return { ok: true, user, storage: "server", deployment };
  });
  app.post("/api/account/logout", async (request, reply) => { sameOrigin(request); store.revokeSession(token(request)); cookie(reply, "", true); return { ok: true }; });
  const deleteAccount = async (request: FastifyRequest, reply: FastifyReply) => {
    sameOrigin(request); const user = authenticate(request);
    const body = z.object({ password: z.string().min(12).max(128), confirmation: z.literal("DELETE") }).strict().parse(request.body);
    limited(request, "login", user.email);
    if (!await verifyPassword(body.password, store.getUserByEmail(user.email)?.password_hash)) throw failure("Email or password is incorrect.", 401);
    store.deleteUser(user.id); cookie(reply, "", true); return { ok: true };
  };
  app.delete("/api/account", deleteAccount);
  app.delete("/api/account/me", deleteAccount);
  app.get("/api/account/training", async request => ({ ok: true, ...store.training(authenticate(request).id) }));
  app.post("/api/account/training/save", async request => {
    sameOrigin(request); const user = authenticate(request);
    const guard = z.object({ source_id: z.string().min(1).max(100), reference_key: z.string().regex(/^[a-f0-9]{64}$/), review_version: z.number().int().nonnegative(), title: z.string().trim().min(1).max(120).optional(), include_evidence_images: z.boolean().default(false) }).strict().parse(request.body);
    const session = options.getGuidanceSession(request);
    ensureReview(session, guard);
    const handoff = structuredHandoff(session);
    const sourceChecks = handoff.evidence.filter(event => event.source_id === handoff.source.id && event.reference_key === handoff.reference.reference_key && event.provenance === "ai" && !event.simulated).length;
    return { ok: true, ...store.saveTraining(user.id, guard.title || handoff.reference.title || handoff.source.name || "Guidance session", handoff, sourceChecks, guard.include_evidence_images) };
  });
  app.get("/api/account/training/:id", async request => {
    const user = authenticate(request); const id = z.string().uuid().parse((request.params as { id: string }).id);
    const report = store.report(user.id, id);
    if (!report) throw failure("Saved training session was not found.", 404);
    return { ok: true, report };
  });
  app.get("/api/account/training/:id/report.html", async (request, reply) => {
    const owner = authenticate(request); const id = z.string().uuid().parse((request.params as { id: string }).id);
    const report = store.report(owner.id, id);
    if (!report) throw failure("Saved training session was not found.", 404);
    return reply.type("text/html; charset=utf-8").header("Content-Disposition", `attachment; filename="process-guide-training-${id}.html"`).header("Content-Security-Policy", "default-src 'none'; img-src data:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'").header("X-Content-Type-Options", "nosniff").send(renderAnalysisHtml(report.handoff));
  });
  app.get("/api/account/training/:id/report.pdf", async (request, reply) => {
    const owner = authenticate(request); const initialToken = token(request);
    const id = z.string().uuid().parse((request.params as { id: string }).id);
    const report = store.report(owner.id, id);
    if (!report) throw failure("Saved training session was not found.", 404);
    if (!store.consumeLimit(`report:user:${owner.id}`, 20, 60_000)) throw failure("Too many report downloads. Please try again shortly.", 429);
    if (activePdfRenders >= 2) throw failure("Report generation is busy. Please try again shortly.", 429);
    activePdfRenders++;
    const controller = new AbortController();
    const abort = () => controller.abort();
    request.raw.once("aborted", abort); reply.raw.once("close", abort);
    let pdf: Buffer;
    try { pdf = await (options.renderPdf || renderAnalysisPdf)(report.handoff, controller.signal); controller.signal.throwIfAborted(); }
    finally { activePdfRenders--; request.raw.off("aborted", abort); reply.raw.off("close", abort); }
    // Logging out, deleting the account/report, or rotating a token while an
    // asynchronous render runs must prevent delivery of its private snapshot.
    const current = store.userForToken(initialToken);
    if (!current || current.id !== owner.id) throw failure("Sign in to download this training report.", 401);
    if (!store.report(owner.id, id)) throw failure("Saved training session was not found.", 404);
    return reply.type("application/pdf").header("Content-Disposition", `attachment; filename="process-guide-training-${id}.pdf"`).header("X-Content-Type-Options", "nosniff").send(pdf);
  });
  app.delete("/api/account/training/:id", async request => {
    sameOrigin(request); const user = authenticate(request); const id = z.string().uuid().parse((request.params as { id: string }).id);
    if (!store.deleteReport(user.id, id)) throw failure("Saved training session was not found.", 404);
    return { ok: true };
  });
  return store;
}
