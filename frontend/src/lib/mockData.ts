import type {
  Stage,
  ModelOption,
  MetricSpec,
  LogLine,
  ReportEntry,
} from "./types";
export const MODELS: ModelOption[] = [
  { display: "GPT-6 Astra", provider: "openai", model_id: "gpt-6-astra" },
  { display: "GPT-6.1 Sol", provider: "openai", model_id: "gpt-6.1-sol" },
  { display: "GPT-6 Luna", provider: "openai", model_id: "gpt-6-luna" },
  { display: "GPT-4o", provider: "openai", model_id: "gpt-4o" },
  { display: "GPT-4o mini", provider: "openai", model_id: "gpt-4o-mini" },
  {
    display: "Claude Sonnet 4",
    provider: "anthropic",
    model_id: "claude-sonnet-4-20250514",
  },
  {
    display: "Claude Haiku 4.5",
    provider: "anthropic",
    model_id: "claude-haiku-4-5",
  },
  {
    display: "Gemini 3 Flash",
    provider: "google",
    model_id: "gemini-3-flash-preview",
  },
  {
    display: "Qwen Vision",
    provider: "qwen",
    model_id: "Qwen/Qwen2.5-VL-32B-Instruct",
  },
  { display: "Local vision model", provider: "local", model_id: "llava" },
];
export const STAGES: Stage[] = [];
export const METRICS: MetricSpec[] = [];
export const INITIAL_LOGS: LogLine[] = [];
export const GUIDANCE_MESSAGES: string[] = [];
export const REPORT_ENTRIES: ReportEntry[] = [];
