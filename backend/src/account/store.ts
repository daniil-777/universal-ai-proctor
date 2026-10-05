import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import type { DatabaseSync as SqliteDatabase } from "node:sqlite";
import type { StructuredHandoff } from "../domain/review.js";

export interface AccountUser { id: string; email: string; name: string; created_at: number }
export interface AccountRecord extends AccountUser { password_hash: string }
export interface TrainingEntry {
  id: string; saved_at: number; title: string; source_id: string; reference_key: string; source_name: string; source_kind: string; reference_name: string;
  work_order: string; asset: string; operator: string; steps: number; confirmed_steps: number;
  ai_confirmed_steps: number; operator_confirmed_steps: number; open_exceptions: number;
  visual_checks: number; duration_s: number | null;
  includes_evidence_images: boolean;
}
export interface TrainingReport { id: string; saved_at: number; title: string; handoff: StructuredHandoff }
interface StoreOptions { file?: string; now?: () => number; sessionTtlMs?: number; maxReports?: number }
const digest = (value: string) => crypto.createHash("sha256").update(value).digest("hex");
// Vitest 2 predates node:sqlite; keep runtime built-in resolution with Node.
const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite") as typeof import("node:sqlite");
export const publicUser = ({ id, email, name, created_at }: AccountUser): AccountUser => ({ id, email, name, created_at });

export class AccountStore {
  private database: SqliteDatabase;
  private now: () => number;
  readonly sessionTtlMs: number;
  private maxReports: number;
  private closed = false;
  constructor(options: StoreOptions = {}) {
    const file = options.file || path.join(path.resolve(process.env.DATA_DIR || ".data/accounts"), "accounts.sqlite");
    this.now = options.now || Date.now;
    this.sessionTtlMs = options.sessionTtlMs || 7 * 24 * 60 * 60 * 1000;
    this.maxReports = options.maxReports || 500;
    if (file !== ":memory:") fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    this.database = new DatabaseSync(file);
    this.database.exec("PRAGMA busy_timeout = 1000; PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL; PRAGMA foreign_keys = ON;");
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS account_users (
        id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, name TEXT NOT NULL,
        password_hash TEXT NOT NULL, created_at INTEGER NOT NULL
      ) STRICT;
      CREATE TABLE IF NOT EXISTS account_sessions (
        token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES account_users(id) ON DELETE CASCADE,
        created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL
      ) STRICT;
      CREATE INDEX IF NOT EXISTS account_sessions_expiry ON account_sessions(expires_at);
      CREATE TABLE IF NOT EXISTS account_limits (
        key_hash TEXT PRIMARY KEY, count INTEGER NOT NULL, resets_at INTEGER NOT NULL
      ) STRICT;
      CREATE TABLE IF NOT EXISTS account_training (
        id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES account_users(id) ON DELETE CASCADE,
        saved_at INTEGER NOT NULL, title TEXT NOT NULL, source_id TEXT NOT NULL, reference_key TEXT NOT NULL,
        review_version INTEGER NOT NULL, summary_json TEXT NOT NULL, handoff_json TEXT NOT NULL,
        UNIQUE(user_id, source_id, reference_key, review_version)
      ) STRICT;
      CREATE INDEX IF NOT EXISTS account_training_owner ON account_training(user_id, saved_at DESC);
      CREATE UNIQUE INDEX IF NOT EXISTS account_training_run ON account_training(user_id, source_id, reference_key);
    `);
    if (file !== ":memory:") fs.chmodSync(file, 0o600);
  }
  close() { if (!this.closed) { this.closed = true; this.database.close(); } }
  private transaction<T>(operation: () => T): T {
    this.database.exec("BEGIN IMMEDIATE");
    try { const result = operation(); this.database.exec("COMMIT"); return result; }
    catch (error) { this.database.exec("ROLLBACK"); throw error; }
  }
  getUserByEmail(email: string): AccountRecord | undefined {
    return this.database.prepare("SELECT id, email, name, password_hash, created_at FROM account_users WHERE email = ?").get(email) as unknown as AccountRecord | undefined;
  }
  createUser(email: string, name: string, passwordHash: string): AccountUser {
    const user = { id: crypto.randomUUID(), email, name, created_at: this.now() };
    try { this.database.prepare("INSERT INTO account_users (id,email,name,password_hash,created_at) VALUES (?,?,?,?,?)").run(user.id, email, name, passwordHash, user.created_at); }
    catch (error) {
      if (this.getUserByEmail(email)) throw Object.assign(new Error("An account with these details could not be created. Try signing in."), { statusCode: 409 });
      throw error;
    }
    return user;
  }
  rotateSession(userId: string, previousToken?: string): string {
    const token = crypto.randomBytes(32).toString("base64url");
    this.database.exec("BEGIN IMMEDIATE");
    try {
      this.database.prepare("DELETE FROM account_sessions WHERE expires_at <= ?").run(this.now());
      if (previousToken) this.database.prepare("DELETE FROM account_sessions WHERE token_hash = ?").run(digest(previousToken));
      // Bound independently active sign-ins without silently accumulating tokens.
      this.database.prepare("DELETE FROM account_sessions WHERE user_id = ? AND token_hash NOT IN (SELECT token_hash FROM account_sessions WHERE user_id = ? ORDER BY created_at DESC LIMIT 9)").run(userId, userId);
      this.database.prepare("INSERT INTO account_sessions (token_hash,user_id,created_at,expires_at) VALUES (?,?,?,?)").run(digest(token), userId, this.now(), this.now() + this.sessionTtlMs);
      this.database.exec("COMMIT"); return token;
    } catch (error) { this.database.exec("ROLLBACK"); throw error; }
  }
  userForToken(token?: string): AccountUser | undefined {
    if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token)) return undefined;
    const user = this.database.prepare("SELECT u.id,u.email,u.name,u.created_at FROM account_users u JOIN account_sessions s ON u.id = s.user_id WHERE s.token_hash = ? AND s.expires_at > ?").get(digest(token), this.now()) as unknown as AccountUser | undefined;
    return user ? publicUser(user) : undefined;
  }
  revokeSession(token?: string) { if (token) this.database.prepare("DELETE FROM account_sessions WHERE token_hash = ?").run(digest(token)); }
  deleteUser(userId: string) { this.database.prepare("DELETE FROM account_users WHERE id = ?").run(userId); }
  consumeLimit(key: string, limit: number, windowMs: number): boolean {
    const keyHash = digest(key);
    this.database.prepare("DELETE FROM account_limits WHERE resets_at <= ?").run(this.now());
    const row = this.database.prepare("INSERT INTO account_limits (key_hash,count,resets_at) VALUES (?,1,?) ON CONFLICT(key_hash) DO UPDATE SET count = count + 1 RETURNING count").get(keyHash, this.now() + windowMs) as { count: number };
    return row.count <= limit;
  }
  saveTraining(userId: string, title: string, handoff: StructuredHandoff, visualChecks: number, includeEvidenceImages = false): { id: string; saved_at: number; existing: boolean } {
    return this.transaction(() => {
    const previous = this.database.prepare("SELECT id,saved_at,review_version,title,summary_json FROM account_training WHERE user_id = ? AND source_id = ? AND reference_key = ?").get(userId, handoff.source.id, handoff.reference.reference_key) as { id: string; saved_at: number; review_version: number; title: string; summary_json: string } | undefined;
    // Progress, operator confirmations and seek state can change without a review
    // version change. Always capture the current server snapshot at that version.
    if (previous && previous.review_version > handoff.review_version) return { id: previous.id, saved_at: previous.saved_at, existing: true };
    const size = this.database.prepare("SELECT COUNT(*) AS count FROM account_training WHERE user_id = ?").get(userId) as { count: number };
    if (!previous && size.count >= this.maxReports) throw Object.assign(new Error("Your training history is full. Delete an older saved session before saving another."), { statusCode: 429 });
    // Original video/audio media and the original guidance document are never retained.
    const savedHandoff = structuredClone(handoff);
    if (!includeEvidenceImages) {
      const omittedImages = savedHandoff.evidence.filter(event => event.thumbnail_b64).length;
      savedHandoff.evidence = savedHandoff.evidence.map(({ thumbnail_b64: _image, ...event }) => event);
      savedHandoff.retention.retained_thumbnails = 0;
      savedHandoff.retention.retained_thumbnail_bytes = 0;
      if (omittedImages) savedHandoff.notice += ` ${omittedImages} evidence image(s) were excluded from this saved account snapshot by the operator's storage choice.`;
    }
    const handoffJson = JSON.stringify(savedHandoff);
    if (Buffer.byteLength(handoffJson) > 2 * 1024 * 1024) throw Object.assign(new Error("This session is too large to save. Export the handoff locally instead."), { statusCode: 413 });
    const entry: TrainingEntry = {
      id: previous?.id || crypto.randomUUID(), saved_at: this.now(), title, source_id: handoff.source.id, reference_key: handoff.reference.reference_key, source_name: handoff.source.name, source_kind: handoff.source.kind,
      reference_name: handoff.reference.filename, work_order: handoff.job.work_order, asset: handoff.job.asset, operator: handoff.job.operator,
      steps: handoff.progress.length, confirmed_steps: handoff.progress.filter(step => step.complete).length,
      ai_confirmed_steps: handoff.progress.filter(step => step.complete && step.confirmation === "AI").length,
      operator_confirmed_steps: handoff.progress.filter(step => step.complete && step.confirmation === "manual").length,
      open_exceptions: handoff.open_exceptions.length, visual_checks: Math.max(0, Math.floor(visualChecks)), duration_s: handoff.source.duration_s,
      includes_evidence_images: includeEvidenceImages,
    };
    this.database.prepare("INSERT INTO account_training (id,user_id,saved_at,title,source_id,reference_key,review_version,summary_json,handoff_json) VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT(user_id,source_id,reference_key) DO UPDATE SET saved_at=excluded.saved_at,title=excluded.title,review_version=excluded.review_version,summary_json=excluded.summary_json,handoff_json=excluded.handoff_json WHERE excluded.review_version >= account_training.review_version").run(entry.id, userId, entry.saved_at, title, handoff.source.id, handoff.reference.reference_key, handoff.review_version, JSON.stringify(entry), handoffJson);
    return { id: entry.id, saved_at: entry.saved_at, existing: false };
    });
  }
  training(userId: string) {
    const history = (this.database.prepare("SELECT summary_json FROM account_training WHERE user_id = ? ORDER BY saved_at DESC,id DESC LIMIT ?").all(userId, this.maxReports) as Array<{ summary_json: string }>).map(row => JSON.parse(row.summary_json) as TrainingEntry);
    const sum = (key: keyof TrainingEntry) => history.reduce((total, entry) => total + Number(entry[key] || 0), 0);
    return {
      history,
      summary: { sessions: history.length, total_steps: sum("steps"), confirmed_steps: sum("confirmed_steps"), ai_confirmed_steps: sum("ai_confirmed_steps"), operator_confirmed_steps: sum("operator_confirmed_steps"), open_exceptions: sum("open_exceptions"), observed_sources: new Set(history.map(entry => entry.source_id)).size, total_visual_checks: sum("visual_checks") },
      notice: "One saved activity per input and guidance reference; subsequent saves update that activity. Visual checks count retained, non-demo observations for that reference. Confirmation counts describe activity, not certified proficiency or calibrated AI accuracy.",
    };
  }
  report(userId: string, id: string): TrainingReport | undefined {
    const row = this.database.prepare("SELECT id,saved_at,title,handoff_json FROM account_training WHERE user_id = ? AND id = ?").get(userId, id) as { id: string; saved_at: number; title: string; handoff_json: string } | undefined;
    return row ? { id: row.id, saved_at: row.saved_at, title: row.title, handoff: JSON.parse(row.handoff_json) as StructuredHandoff } : undefined;
  }
  deleteReport(userId: string, id: string): boolean {
    return Number(this.database.prepare("DELETE FROM account_training WHERE user_id = ? AND id = ?").run(userId, id).changes) > 0;
  }
}
