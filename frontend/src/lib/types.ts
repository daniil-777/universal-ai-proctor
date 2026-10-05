export type CriterionStatus = "met" | "not_met" | "partial" | "unknown";

export interface Criterion {
  key: string;
  label: string;
  status: CriterionStatus;
  evidence?: string;
}

export interface Stage {
  id: string;
  index: number;
  name: string;
  description: string;
  objective: string;
  expectedInstruments: string[];
  actions: string[];
  typicalDurationMin: number;
  criteria: Criterion[];
  confidence: number;
  complete: boolean;
  progress?: number;
  source?: "document" | "inferred";
  confirmation?: "AI" | "manual";
  lastObservedS?: number;
}

export interface AnalysisEvent {
  timestamp_s: number;
  event_type: string;
  actor_instrument?: string;
  target_structure?: string;
  direction?: string;
  confidence: number;
  evidence?: string;
}

export interface ClassificationResult {
  current_stage_id: string;
  current_stage_name: string;
  stage_present: boolean;
  stage_complete: boolean;
  confidence: number;
  criteria: Criterion[];
  events: AnalysisEvent[];
  guidance_message: string;
}

export interface MetricSpec {
  key: string;
  label: string;
  value: number | string;
  unit?: string;
  trend?: number[];
  tone?: "neutral" | "success" | "warning" | "danger";
}

export interface LogLine {
  ts: number;
  level: "info" | "success" | "warn" | "error";
  source:
    | "Simulator"
    | "SimParams"
    | "Guardian"
    | "Prompt"
    | "Reference"
    | "Event"
    | "System"
    | "History";
  msg: string;
}

export type AppMode = "surgeon" | "engineer";
export type ExperienceLevel = "Beginner" | "Intermediate" | "Expert";
export type TaskType = "Phase" | "Step" | "Triplet" | "Error";

export interface ModelOption {
  display: string;
  provider: string;
  model_id: string;
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
  ts: number;
  streaming?: boolean;
  frames?: string[];
}

export interface ReportEntry {
  id: string;
  stage: string;
  time: number;
  thumb?: string;
  criteria: Criterion[];
  notes: string;
  voice?: string;
  events: AnalysisEvent[];
}
