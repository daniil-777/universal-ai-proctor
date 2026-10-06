import fs from "node:fs";
import path from "node:path";
import { config } from "../config.js";
import type { RefRow, Workflow, Observation } from "./guidance.js";
import type { Confirmations } from "./progress.js";
import type { ReviewState } from "./review.js";
export interface Session {
  id: string;
  touched: number;
  revision: number;
  operatorGoals?: string;
  preferencesRevision?: number;
  review?: ReviewState;
  filename: string;
  text: string;
  rows: RefRow[];
  workflow: Workflow;
  currentId: string;
  votes: Confirmations;
  videoPath?: string;
  videoInfo?: { duration: number; fps: number; width: number; height: number };
  sourceId: string;
  sourceKind?: "video" | "camera" | "screen";
  sourceName?: string;
  sampleVideoId?: string;
  mediaGeneration: number;
  disposed?: boolean;
  lastTime: number;
  snapshots: Array<{ time: number; workflow: Workflow; votes: Confirmations }>;
  observations: Array<{ time: number; value: Observation }>;
  cache: Map<string, { expires: number; value: unknown }>;
  inflight: Map<string, Promise<unknown>>;
  stats: { checks: number; cacheHits: number; lastLatency: number };
}
export class SessionStore {
  private sessions = new Map<string, Session>();
  private disposeListeners = new Set<(session: Session) => void>();
  constructor(
    private ttl = 60 * 60 * 1000,
    private max = 100,
  ) {}
  get(id: string): Session {
    this.sweep();
    let s = this.sessions.get(id);
    if (!s) {
      if (this.sessions.size >= this.max) {
        const oldest = [...this.sessions.values()].sort(
          (a, b) => a.touched - b.touched,
        )[0];
        if (oldest) this.remove(oldest.id);
      }
      s = {
        id,
        touched: Date.now(),
        revision: 0,
        operatorGoals: "",
        preferencesRevision: 0,
        filename: "",
        text: "",
        rows: [],
        workflow: {
          title: "Visual guidance",
          steps: [],
          principles: [],
          source: "none",
          warnings: [],
        },
        currentId: "",
        votes: new Map(),
        sourceId: "",
        mediaGeneration: 0,
        lastTime: 0,
        snapshots: [],
        observations: [],
        cache: new Map(),
        inflight: new Map(),
        stats: { checks: 0, cacheHits: 0, lastLatency: 0 },
      };
      this.sessions.set(id, s);
    }
    s.touched = Date.now();
    return s;
  }
  sweep() {
    for (const s of this.sessions.values())
      if (Date.now() - s.touched > this.ttl) this.remove(s.id);
  }
  remove(id: string) {
    const session = this.sessions.get(id);
    if (session) {
      for (const listener of this.disposeListeners) listener(session);
      session.disposed = true;
      session.mediaGeneration++;
      session.revision++;
    }
    this.sessions.delete(id);
    fs.rmSync(path.join(config.uploadRoot, id), {
      recursive: true,
      force: true,
    });
  }
  clear() {
    for (const id of this.sessions.keys()) this.remove(id);
  }
  onDispose(listener: (session: Session) => void): () => void {
    this.disposeListeners.add(listener);
    return () => this.disposeListeners.delete(listener);
  }
  get size() {
    return this.sessions.size;
  }
}
