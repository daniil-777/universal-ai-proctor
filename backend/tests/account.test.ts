import { afterAll, beforeAll, describe, expect, it } from "vitest";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Fastify from "fastify";
import { createApp } from "../src/app.js";
import { AccountStore } from "../src/account/store.js";
import { hashPassword, verifyPassword } from "../src/account/password.js";
import { registerAccountRoutes } from "../src/account/routes.js";
import { SessionStore } from "../src/domain/session.js";
import { ObservationSchema } from "../src/domain/guidance.js";
import { captureObservationReview, reviewSnapshot, structuredHandoff, syncReview, touchReview } from "../src/domain/review.js";
import { GuidanceEngine } from "../src/pipeline/guidance.js";
import { fixtureComplete, fixtureDocument } from "./fixtures.js";

const accounts = new AccountStore({ file: ":memory:" });
const sessions = new SessionStore();
const app = await createApp({ accountStore: accounts, store: sessions, engine: new GuidanceEngine(fixtureComplete) });
const origin = "http://localhost:8102";
const password = "Natural guidance test 42!";
let passwordHash: string;
const guidanceId = crypto.randomUUID();
const request = (method: "GET" | "POST" | "PUT" | "DELETE", url: string, payload?: object, cookie?: string, headers: Record<string, string> = {}) => app.inject({ method, url, payload, headers: { host: "localhost:8102", origin, "x-guidance-session": guidanceId, ...(cookie ? { cookie } : {}), ...headers } });
const getCookie = (response: { headers: Record<string, unknown> }) => {
  const values = response.headers["set-cookie"];
  return (Array.isArray(values) ? values : [values]).map(String).find(value => value.startsWith("process-guide-account="))!.split(";")[0]!;
};
function user() {
  const account = accounts.createUser(`${crypto.randomUUID()}@example.com`, "Operator", passwordHash);
  return { account, cookie: `process-guide-account=${accounts.rotateSession(account.id)}` };
}
const guard = () => {
  const review = reviewSnapshot(sessions.get(guidanceId));
  return { source_id: review.source_id, reference_key: review.reference_key, review_version: review.review_version };
};
async function source(name = "inspection.mp4") {
  await request("POST", "/api/source", { source_id: crypto.randomUUID(), kind: "video", name });
  await request("PUT", "/api/reference/document", { text: fixtureDocument });
  const session = sessions.get(guidanceId);
  session.videoInfo = { duration: 40, fps: 30, width: 640, height: 360 };
  return session;
}
beforeAll(async () => { passwordHash = await hashPassword(password); });
afterAll(async () => { await app.close(); accounts.close(); });

describe("account authentication and privacy", () => {
  it("keeps anonymous guidance available but protects training history", async () => {
    expect((await request("GET", "/api/account/me")).json()).toMatchObject({ ok: true, user: null, storage: "server", deployment: "local" });
    expect((await request("GET", "/api/account/training")).statusCode).toBe(401);
    expect((await request("POST", "/api/account/training/save", {})).statusCode).toBe(401);
    expect((await request("GET", "/api/reference")).statusCode).toBe(200);
  });
  it("uses randomized scrypt salts and verifies passwords with no plaintext storage", async () => {
    const second = await hashPassword(password);
    expect(second).not.toBe(passwordHash);
    expect(passwordHash).toMatch(/^scrypt\$131072\$8\$1\$[a-f0-9]{32}\$[a-f0-9]{128}$/);
    expect(passwordHash).not.toContain(password);
    expect(await verifyPassword(password, passwordHash)).toBe(true);
    expect(await verifyPassword("a different valid password", passwordHash)).toBe(false);
    expect(await verifyPassword(password)).toBe(false);
    expect(await verifyPassword(password, "corrupted")).toBe(false);
  });
  it("enforces long bounded passwords and validated registration fields", async () => {
    for (const body of [
      { email: "valid@example.com", name: "Operator", password: "short" },
      { email: "invalid", name: "Operator", password },
      { email: "valid@example.com", name: "", password },
      { email: "valid@example.com", name: "Operator", password: "x".repeat(129) },
      { email: "valid@example.com", name: "Operator", password, role: "admin" },
    ]) expect((await request("POST", "/api/account/register", body)).statusCode).toBe(400);
  });
  it("registers normalized email and returns only public user fields", async () => {
    const response = await request("POST", "/api/account/register", { name: "  Alex  ", email: "  ALEX.Account@EXAMPLE.COM  ", password });
    expect(response.statusCode).toBe(200);
    expect(response.json().user).toEqual({ id: expect.any(String), name: "Alex", email: "alex.account@example.com", created_at: expect.any(Number) });
    expect(JSON.stringify(response.json())).not.toMatch(/password|scrypt|token/);
    const cookie = getCookie(response);
    const fullCookie = String(response.headers["set-cookie"]);
    expect(fullCookie).toContain("HttpOnly"); expect(fullCookie).toContain("SameSite=Strict"); expect(fullCookie).not.toContain("Secure");
    expect((await request("GET", "/api/account/me", undefined, cookie)).json().user.email).toBe("alex.account@example.com");
    expect((await request("GET", "/api/account/me", undefined, cookie)).headers["cache-control"]).toBe("no-store");
    expect((await request("POST", "/api/account/register", { name: "Another", email: "alex.account@example.com", password })).statusCode).toBe(409);
  });
  it("rejects missing, mismatched and cross-site origins before account mutations", async () => {
    const account = user();
    for (const headers of [{ origin: "https://attacker.example" }, { origin: "" }, { "sec-fetch-site": "cross-site" }]) {
      expect((await request("POST", "/api/account/logout", {}, account.cookie, headers)).statusCode).toBe(403);
      expect((await request("POST", "/api/account/login", { email: account.account.email, password }, undefined, headers)).statusCode).toBe(403);
      expect((await request("DELETE", "/api/account/training/" + crypto.randomUUID(), undefined, account.cookie, headers)).statusCode).toBe(403);
    }
    expect((await request("GET", "/api/account/me", undefined, account.cookie)).json().user.id).toBe(account.account.id);
  });
  it("returns the same login failure for unknown accounts and wrong passwords", async () => {
    const account = user();
    const unknown = await request("POST", "/api/account/login", { email: "missing@example.com", password });
    const wrong = await request("POST", "/api/account/login", { email: account.account.email, password: "incorrect sufficiently long password" });
    expect(unknown.statusCode).toBe(401); expect(wrong.statusCode).toBe(401);
    expect(unknown.json()).toEqual(wrong.json());
  });
  it("rotates login tokens and revokes the previous token on logout", async () => {
    const account = user();
    const login = await request("POST", "/api/account/login", { email: account.account.email.toUpperCase(), password }, account.cookie);
    expect(login.statusCode).toBe(200);
    const cookie = getCookie(login);
    expect(cookie).not.toBe(account.cookie);
    expect((await request("GET", "/api/account/me", undefined, account.cookie)).json().user).toBeNull();
    expect((await request("GET", "/api/account/me", undefined, cookie)).json().user.id).toBe(account.account.id);
    const logout = await request("POST", "/api/account/logout", {}, cookie);
    expect(logout.statusCode).toBe(200); expect(String(logout.headers["set-cookie"])).toContain("Max-Age=0");
    expect((await request("GET", "/api/account/me", undefined, cookie)).json().user).toBeNull();
  });
  it("rejects duplicate cookie names and arbitrary malformed session tokens", async () => {
    const account = user();
    expect((await request("GET", "/api/account/me", undefined, `${account.cookie}; ${account.cookie}`)).json().user).toBeNull();
    expect((await request("GET", "/api/account/me", undefined, "process-guide-account=../../../accounts.sqlite")).json().user).toBeNull();
  });
  it("expires tokens at their exact deadline and preserves users across database reopening", () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "guide-account-persistence-"));
    const file = path.join(directory, "accounts.sqlite"); let now = 1000;
    const first = new AccountStore({ file, now: () => now, sessionTtlMs: 500 });
    const owner = first.createUser("persistent@example.com", "Persistent", passwordHash); const token = first.rotateSession(owner.id);
    expect(first.userForToken(token)?.id).toBe(owner.id); first.close();
    const second = new AccountStore({ file, now: () => now, sessionTtlMs: 500 });
    expect(second.getUserByEmail("persistent@example.com")?.password_hash).toBe(passwordHash);
    expect(second.userForToken(token)?.id).toBe(owner.id);
    now = 1500; expect(second.userForToken(token)).toBeUndefined();
    second.close(); fs.rmSync(directory, { recursive: true, force: true });
  });
  it("enforces persistent brute-force limits shared by reopened database connections", () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "guide-account-limits-")); const file = path.join(directory, "accounts.sqlite"); let now = 1000;
    const first = new AccountStore({ file, now: () => now });
    expect(first.consumeLimit("login:email:test", 2, 1000)).toBe(true); first.close();
    const second = new AccountStore({ file, now: () => now });
    expect(second.consumeLimit("login:email:test", 2, 1000)).toBe(true); expect(second.consumeLimit("login:email:test", 2, 1000)).toBe(false);
    now = 2000; expect(second.consumeLimit("login:email:test", 2, 1000)).toBe(true);
    second.close(); fs.rmSync(directory, { recursive: true, force: true });
  });
  it("rate-limits real login routes and pins hosted HTTPS origins and secure cookies", async () => {
    const secureAccounts = new AccountStore({ file: ":memory:" });
    const secureApp = Fastify();
    registerAccountRoutes(secureApp, { store: secureAccounts, publicOrigin: "https://guide.example.com", limits: { loginIp: 2, loginEmail: 1 }, getGuidanceSession: () => sessions.get(guidanceId) });
    secureApp.setErrorHandler((error, _request, reply) => reply.code(error.statusCode || 500).send({ error: error.message }));
    const owner = secureAccounts.createUser("hosted@example.com", "Hosted", passwordHash);
    const headers = { host: "guide.example.com", origin: "https://guide.example.com" };
    const signedIn = await secureApp.inject({ method: "POST", url: "/api/account/login", headers, payload: { email: owner.email, password } });
    expect(signedIn.statusCode).toBe(200); expect(String(signedIn.headers["set-cookie"])).toContain("Secure");
    expect((await secureApp.inject({ method: "GET", url: "/api/account/me", headers: { ...headers, cookie: getCookie(signedIn) } })).json().deployment).toBe("hosted");
    const blocked = await secureApp.inject({ method: "POST", url: "/api/account/login", headers, payload: { email: owner.email, password } });
    expect(blocked.statusCode).toBe(429);
    const spoofed = await secureApp.inject({ method: "POST", url: "/api/account/logout", headers: { host: "attacker.example", origin: "http://attacker.example" }, payload: {} });
    expect(spoofed.statusCode).toBe(403);
    await secureApp.close(); secureAccounts.close();
  });
  it("preserves the guidance session cookie when setting an account cookie", async () => {
    const response = await app.inject({ method: "POST", url: "/api/account/register", headers: { host: "localhost:8102", origin }, payload: { email: "cookies@example.com", name: "Cookies", password } });
    expect(response.statusCode).toBe(200);
    const cookies = response.headers["set-cookie"];
    expect(Array.isArray(cookies)).toBe(true);
    expect((cookies as string[]).some(value => value.startsWith("guidance-session="))).toBe(true);
    expect((cookies as string[]).some(value => value.startsWith("process-guide-account="))).toBe(true);
  });
  it("bounds concurrent memory-heavy password derivations", async () => {
    const operations = await Promise.allSettled([hashPassword(password), hashPassword(password), hashPassword(password)]);
    expect(operations.filter(result => result.status === "fulfilled")).toHaveLength(2);
    const rejected = operations.find(result => result.status === "rejected");
    expect(rejected).toMatchObject({ status: "rejected", reason: { statusCode: 429 } });
  });
});

describe("persistent training snapshots and metric provenance", () => {
  it("captures guarded server data and separates AI, operator and unobserved progress", async () => {
    const account = user(); const session = await source();
    session.workflow.steps[0]!.complete = true; session.workflow.steps[0]!.confirmation = "AI"; session.workflow.steps[0]!.progress = 100;
    session.workflow.steps[0]!.criteria[0]!.status = "met";
    session.stats.checks = 99999; // Global legacy stats must not become this source's training metric.
    const snapshot = reviewSnapshot(session);
    captureObservationReview(session, ObservationSchema.parse({ summary: "Tool visible.", guidance: "Inspect the work area.", concern: "Clear the work area.", status: "watch" }), { time: 5, milestones: [], occurredAt: Date.now(), model: "fixture" });
    expect(snapshot.source_id).toBe(session.sourceId);
    const saved = await request("POST", "/api/account/training/save", { ...guard(), title: "Inspection practice" }, account.cookie);
    expect(saved.statusCode).toBe(200);
    const history = (await request("GET", "/api/account/training", undefined, account.cookie)).json();
    expect(history.summary).toMatchObject({ sessions: 1, total_steps: 2, confirmed_steps: 1, ai_confirmed_steps: 1, operator_confirmed_steps: 0, open_exceptions: 1, total_visual_checks: 1 });
    const report = (await request("GET", `/api/account/training/${saved.json().id}`, undefined, account.cookie)).json().report;
    expect(report).toMatchObject({ title: "Inspection practice", handoff: { source: { id: session.sourceId, name: "inspection.mp4" }, reference: { filename: "Custom guidance.txt" }, unresolved_criteria: expect.any(Array) } });
    expect(history.notice).toContain("not certified proficiency");
  });
  it("deduplicates repeated saves and updates the same run without inflating metrics", async () => {
    const account = user(); const session = await source();
    const first = (await request("POST", "/api/account/training/save", guard(), account.cookie)).json();
    const repeat = (await request("POST", "/api/account/training/save", guard(), account.cookie)).json();
    expect(repeat).toMatchObject({ id: first.id, existing: false });
    session.workflow.steps[1]!.complete = true; session.workflow.steps[1]!.confirmation = "manual";
    touchReview(syncReview(session));
    const changed = (await request("POST", "/api/account/training/save", guard(), account.cookie)).json();
    expect(changed.id).toBe(first.id);
    expect((await request("GET", "/api/account/training", undefined, account.cookie)).json().summary).toMatchObject({ sessions: 1, total_steps: 2, operator_confirmed_steps: 1 });
  });
  it("accumulates independent source runs and prevents client-forged metrics", async () => {
    const account = user(); await source("first.mp4");
    await request("POST", "/api/account/training/save", guard(), account.cookie);
    await source("second.mp4"); await request("POST", "/api/account/training/save", guard(), account.cookie);
    const history = (await request("GET", "/api/account/training", undefined, account.cookie)).json();
    expect(history.summary.sessions).toBe(2); expect(history.summary.observed_sources).toBe(2);
    expect(history.history.map((entry: { source_name: string }) => entry.source_name).sort()).toEqual(["first.mp4", "second.mp4"]);
    expect((await request("POST", "/api/account/training/save", { ...guard(), visual_checks: 1000, confirmed_steps: 999 }, account.cookie)).statusCode).toBe(400);
  });
  it("resaves manual confirmation and rewind changes even when review version stays unchanged", async () => {
    const account = user(); const session = await source();
    const first = (await request("POST", "/api/account/training/save", guard(), account.cookie)).json();
    const originalReviewVersion = guard().review_version;
    expect((await request("POST", "/api/workflow/steps/S1/confirm", { complete: true, current_s: 10 })).statusCode).toBe(200);
    expect(guard().review_version).toBe(originalReviewVersion);
    const confirmed = (await request("POST", "/api/account/training/save", guard(), account.cookie)).json();
    expect(confirmed.id).toBe(first.id);
    expect((await request("GET", `/api/account/training/${first.id}`, undefined, account.cookie)).json().report.handoff.progress[0]).toMatchObject({ complete: true, confirmation: "manual" });
    expect((await request("GET", "/api/account/training", undefined, account.cookie)).json().summary).toMatchObject({ sessions: 1, operator_confirmed_steps: 1 });
    expect((await request("POST", "/api/workflow/seek", { source_id: session.sourceId, current_s: 2 })).statusCode).toBe(200);
    expect(guard().review_version).toBe(originalReviewVersion);
    const rewound = (await request("POST", "/api/account/training/save", guard(), account.cookie)).json();
    expect(rewound.id).toBe(first.id);
    expect((await request("GET", `/api/account/training/${first.id}`, undefined, account.cookie)).json().report.handoff.progress[0]).toMatchObject({ complete: false, confirmation: null });
    expect((await request("GET", "/api/account/training", undefined, account.cookie)).json().summary).toMatchObject({ sessions: 1, confirmed_steps: 0 });
  });
  it("rejects stale source, document and review guards before saving", async () => {
    const account = user(); const session = await source(); const stale = guard();
    touchReview(syncReview(session));
    expect((await request("POST", "/api/account/training/save", stale, account.cookie)).statusCode).toBe(409);
    expect((await request("POST", "/api/account/training/save", { ...guard(), reference_key: "a".repeat(64) }, account.cookie)).statusCode).toBe(409);
    expect((await request("POST", "/api/account/training/save", { ...guard(), source_id: "previous-video" }, account.cookie)).statusCode).toBe(409);
    expect((await request("GET", "/api/account/training", undefined, account.cookie)).json().history).toEqual([]);
  });
  it("does not share report content or deletion authority between accounts", async () => {
    const owner = user(); const other = user(); await source();
    const saved = (await request("POST", "/api/account/training/save", guard(), owner.cookie)).json();
    expect((await request("GET", "/api/account/training", undefined, other.cookie)).json().history).toEqual([]);
    expect((await request("GET", `/api/account/training/${saved.id}`, undefined, other.cookie)).statusCode).toBe(404);
    expect((await request("DELETE", `/api/account/training/${saved.id}`, undefined, other.cookie)).statusCode).toBe(404);
    expect((await request("GET", `/api/account/training/${saved.id}`, undefined, owner.cookie)).statusCode).toBe(200);
    expect((await request("DELETE", `/api/account/training/${saved.id}`, undefined, owner.cookie)).statusCode).toBe(200);
    expect((await request("GET", `/api/account/training/${saved.id}`, undefined, owner.cookie)).statusCode).toBe(404);
  });
  it("stores text evidence by default and photographic evidence only with explicit opt-in", async () => {
    const account = user(); const session = await source();
    captureObservationReview(session, ObservationSchema.parse({ summary: "Tool visible.", guidance: "Inspect.", status: "ok" }), { time: 1, milestones: [], occurredAt: Date.now(), thumbnail: "data:image/jpeg;base64,AA==" });
    const first = (await request("POST", "/api/account/training/save", guard(), account.cookie)).json();
    let report = (await request("GET", `/api/account/training/${first.id}`, undefined, account.cookie)).json().report;
    expect(report.handoff.evidence[0].thumbnail_b64).toBeUndefined();
    expect(report.handoff.retention.retained_thumbnails).toBe(0);
    expect(report.handoff.notice).toContain("operator's storage choice");
    expect(syncReview(session).events[0]!.thumbnail_b64).toBeDefined();
    const optIn = (await request("POST", "/api/account/training/save", { ...guard(), include_evidence_images: true }, account.cookie)).json();
    expect(optIn.id).toBe(first.id);
    report = (await request("GET", `/api/account/training/${first.id}`, undefined, account.cookie)).json().report;
    expect(report.handoff.evidence[0].thumbnail_b64).toBe("data:image/jpeg;base64,AA==");
    expect((await request("GET", "/api/account/training", undefined, account.cookie)).json().history[0].includes_evidence_images).toBe(true);
    await request("POST", "/api/account/training/save", guard(), account.cookie);
    expect((await request("GET", `/api/account/training/${first.id}`, undefined, account.cookie)).json().report.handoff.evidence[0].thumbnail_b64).toBeUndefined();
  });
  it("excludes demo observations and evidence from previous references from training checks", async () => {
    const account = user(); const session = await source();
    const observation = ObservationSchema.parse({ summary: "Visible.", guidance: "Inspect.", status: "ok" });
    captureObservationReview(session, observation, { time: 1, milestones: [], occurredAt: Date.now(), simulated: true });
    captureObservationReview(session, observation, { time: 2, milestones: [], occurredAt: Date.now() });
    syncReview(session).events[1]!.reference_key = "old reference";
    captureObservationReview(session, observation, { time: 3, milestones: [], occurredAt: Date.now() });
    await request("POST", "/api/account/training/save", guard(), account.cookie);
    expect((await request("GET", "/api/account/training", undefined, account.cookie)).json().summary.total_visual_checks).toBe(1);
  });
  it("persists saved results without a live guidance session or source video", async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "guide-training-persistence-")); const file = path.join(directory, "accounts.sqlite");
    const session = await source(); const first = new AccountStore({ file });
    const owner = first.createUser("persisted-training@example.com", "Operator", passwordHash);
    const saved = first.saveTraining(owner.id, "Saved practice", structuredHandoff(session), 0); first.close();
    const second = new AccountStore({ file });
    expect(second.report(owner.id, saved.id)?.handoff.source.id).toBe(session.sourceId);
    expect(second.training(owner.id).summary.sessions).toBe(1);
    expect(fs.readdirSync(directory)).not.toContain("inspection.mp4");
    second.close(); fs.rmSync(directory, { recursive: true, force: true });
  });
  it("bounds training storage and allows deletion followed by another independent run", async () => {
    const bounded = new AccountStore({ file: ":memory:", maxReports: 1 });
    const owner = bounded.createUser("bounded@example.com", "Bounded", passwordHash);
    const firstSession = await source();
    const first = bounded.saveTraining(owner.id, "First", structuredHandoff(firstSession), 0);
    const secondSession = await source("second.mp4");
    expect(() => bounded.saveTraining(owner.id, "Second", structuredHandoff(secondSession), 0)).toThrow("training history is full");
    expect(bounded.deleteReport(owner.id, first.id)).toBe(true);
    expect(bounded.saveTraining(owner.id, "Second", structuredHandoff(secondSession), 0).id).toEqual(expect.any(String));
    const oversized = structuredHandoff(secondSession);
    oversized.operator_goals = "a".repeat(2 * 1024 * 1024); oversized.review_version++;
    expect(() => bounded.saveTraining(owner.id, "Oversized", oversized, 0)).toThrow("too large to save");
    bounded.close();
  });
  it("deletes all private account data and sessions only after password confirmation", async () => {
    const account = user(); await source(); const secondToken = accounts.rotateSession(account.account.id);
    const saved = (await request("POST", "/api/account/training/save", guard(), account.cookie)).json();
    expect((await request("DELETE", "/api/account/me", { password, confirmation: "NO" }, account.cookie)).statusCode).toBe(400);
    expect((await request("DELETE", "/api/account/me", { password: "wrong but sufficiently long", confirmation: "DELETE" }, account.cookie)).statusCode).toBe(401);
    expect((await request("GET", `/api/account/training/${saved.id}`, undefined, account.cookie)).statusCode).toBe(200);
    expect((await request("DELETE", "/api/account/me", { password, confirmation: "DELETE" }, account.cookie)).statusCode).toBe(200);
    expect(accounts.getUserByEmail(account.account.email)).toBeUndefined();
    expect(accounts.userForToken(secondToken)).toBeUndefined();
    expect(accounts.report(account.account.id, saved.id)).toBeUndefined();
  });
  it("exports owner-only PDF and escaped standalone HTML from the saved snapshot", async () => {
    const owner = user(); const other = user(); const session = await source("unicode-Подготовка.mp4");
    session.workflow.title = '<script>alert("unsafe")</script>';
    const saved = (await request("POST", "/api/account/training/save", guard(), owner.cookie)).json();
    await source("different-active-video.mp4");
    const pdf = await request("GET", `/api/account/training/${saved.id}/report.pdf`, undefined, owner.cookie);
    expect(pdf.statusCode).toBe(200); expect(pdf.headers["content-type"]).toContain("application/pdf");
    expect(pdf.rawPayload.subarray(0, 5).toString()).toBe("%PDF-");
    expect(pdf.headers["cache-control"]).toBe("no-store");
    const html = await request("GET", `/api/account/training/${saved.id}/report.html`, undefined, owner.cookie);
    expect(html.statusCode).toBe(200); expect(html.body).toContain("unicode-Подготовка.mp4");
    expect(html.body).not.toContain("different-active-video.mp4");
    expect(html.body).toContain("&lt;script&gt;"); expect(html.body).not.toContain('<script>alert("unsafe")</script>');
    expect(html.headers["content-security-policy"]).toContain("default-src 'none'");
    for (const format of ["pdf", "html"]) expect((await request("GET", `/api/account/training/${saved.id}/report.${format}`, undefined, other.cookie)).statusCode).toBe(404);
  });
  it.each(["logout", "report deletion", "account deletion"])("withholds an asynchronously rendered private PDF after %s", async action => {
    const delayedStore = new AccountStore({ file: ":memory:" }); const delayedApp = Fastify();
    let notifyStarted!: () => void; let finish!: (value: Buffer) => void;
    const started = new Promise<void>(resolve => { notifyStarted = resolve; });
    const result = new Promise<Buffer>(resolve => { finish = resolve; });
    registerAccountRoutes(delayedApp, { store: delayedStore, getGuidanceSession: () => sessions.get(guidanceId), renderPdf: async () => { notifyStarted(); return result; } });
    delayedApp.setErrorHandler((error, _request, reply) => reply.code(error.statusCode || 500).send({ error: error.message }));
    const owner = delayedStore.createUser("delayed@example.com", "Delayed", passwordHash); const token = delayedStore.rotateSession(owner.id);
    const session = await source(); const saved = delayedStore.saveTraining(owner.id, "Delayed snapshot", structuredHandoff(session), 0);
    const rendering = delayedApp.inject({ method: "GET", url: `/api/account/training/${saved.id}/report.pdf`, headers: { cookie: `process-guide-account=${token}` } });
    await started;
    if (action === "logout") delayedStore.revokeSession(token);
    else if (action === "report deletion") delayedStore.deleteReport(owner.id, saved.id);
    else delayedStore.deleteUser(owner.id);
    finish(Buffer.from("%PDF-private"));
    const response = await rendering;
    expect(response.statusCode).toBe(action === "report deletion" ? 404 : 401);
    expect(response.body).not.toContain("%PDF-private");
    await delayedApp.close(); delayedStore.close();
  });
  it("bounds simultaneous PDF generation without losing a completed owner request", async () => {
    const boundedStore = new AccountStore({ file: ":memory:" }); const boundedApp = Fastify();
    const completions: Array<(value: Buffer) => void> = [];
    registerAccountRoutes(boundedApp, { store: boundedStore, getGuidanceSession: () => sessions.get(guidanceId), renderPdf: () => new Promise<Buffer>(resolve => completions.push(resolve)) });
    boundedApp.setErrorHandler((error, _request, reply) => reply.code(error.statusCode || 500).send({ error: error.message }));
    const owner = boundedStore.createUser("render-bound@example.com", "Bounded", passwordHash); const token = boundedStore.rotateSession(owner.id);
    const saved = boundedStore.saveTraining(owner.id, "Bounded", structuredHandoff(await source()), 0);
    const options = { method: "GET" as const, url: `/api/account/training/${saved.id}/report.pdf`, headers: { cookie: `process-guide-account=${token}` } };
    const one = boundedApp.inject(options); const two = boundedApp.inject(options);
    await new Promise(resolve => setImmediate(resolve));
    expect(completions).toHaveLength(2);
    expect((await boundedApp.inject(options)).statusCode).toBe(429);
    completions.forEach(finish => finish(Buffer.from("%PDF-bounded")));
    expect((await one).statusCode).toBe(200); expect((await two).statusCode).toBe(200);
    await boundedApp.close(); boundedStore.close();
  });
});
