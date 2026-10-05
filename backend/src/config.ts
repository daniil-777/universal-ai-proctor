import fs from "node:fs";
// Environment variables take precedence over optional local configuration.
if (fs.existsSync(".env"))
  for (const line of fs.readFileSync(".env", "utf8").split(/\r?\n/)) {
    const match = /^\s*([A-Z][A-Z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
    if (match && process.env[match[1]!] === undefined)
      process.env[match[1]!] = match[2]!.replace(/^(["'])(.*)\1$/, "$2");
  }
import path from "node:path";
export const config = {
  port: Number(process.env.PORT || 8101),
  host: process.env.HOST || "127.0.0.1",
  trustedProxyCidrs: process.env.TRUST_PROXY_CIDRS || "",
  mock: process.env.MOCK === "1",
  uploadRoot: path.resolve(process.env.UPLOAD_ROOT || ".data/uploads"),
  speech: {
    model: process.env.TTS_MODEL || "gpt-4o-mini-tts",
    voice: process.env.TTS_VOICE || "cedar",
  },
  keys: {
    openai: process.env.OPENAI_API_KEY || "",
    anthropic: process.env.ANTHROPIC_API_KEY || "",
    google: process.env.GOOGLE_API_KEY || "",
    hf: process.env.HF_API_KEY || process.env.QWEN_API_KEY || "",
    localEndpoint: process.env.LOCAL_LLM_ENDPOINT || "http://127.0.0.1:11434",
    localModel: process.env.LOCAL_LLM_MODEL || "llava",
  },
};
export const MODELS = [
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
  {
    display: "Local vision model",
    provider: "local",
    model_id: config.keys.localModel,
  },
];
export function configuredProviders() {
  return {
    openai: !!config.keys.openai,
    anthropic: !!config.keys.anthropic,
    google: !!config.keys.google,
    qwen: !!config.keys.hf,
    local: !!process.env.LOCAL_LLM_MODEL,
  };
}
export function modelSelection(provider?: string, model?: string) {
  const aliases: Record<string, string> = {
    alibaba: "qwen",
    claude: "anthropic",
  };
  const selected =
    aliases[provider?.toLowerCase() || ""] || provider?.toLowerCase();
  const available = configuredProviders();
  const fallback =
    MODELS.find((m) => available[m.provider as keyof typeof available]) ||
    MODELS[0]!;
  if (
    selected &&
    !["openai", "anthropic", "google", "qwen", "local"].includes(selected)
  )
    throw Object.assign(new Error("Unknown AI provider"), { statusCode: 400 });
  if (!selected && model) {
    const named = MODELS.find(
      (m) => m.model_id === model || m.display === model,
    );
    if (!named)
      throw Object.assign(new Error("Choose a provider for a custom model."), {
        statusCode: 400,
      });
    return named;
  }
  if (selected) {
    const found = MODELS.find(
      (m) =>
        m.provider === selected &&
        (!model || m.model_id === model || m.display === model),
    );
    return found || { provider: selected, model_id: model!, display: model! };
  }
  return fallback;
}
