import OpenAI from "openai";
import type { ResponseFormatJSONSchema } from "openai/resources/shared";
import type { ChatCompletionContentPart, ChatCompletionCreateParamsNonStreaming } from "openai/resources/chat/completions";
import type { MessageParam } from "@anthropic-ai/sdk/resources/messages";
export interface ModelInput { provider?: string; model_id?: string; reasoning_effort?: "low" | "medium" | "high"; }
export interface CompletionInput extends ModelInput {
  prompt: string; systemPrompt?: string; frames: Buffer[]; signal?: AbortSignal;
  onDelta?: (text: string) => void; maxTokens?: number; json?: boolean;
  responseFormat?: ResponseFormatJSONSchema; vision_detail?: "auto" | "low" | "high";
}
export type Complete = (input: CompletionInput) => Promise<string>;
// Modern reasoning budgets include invisible reasoning tokens as well as output.
// Legacy and non-OpenAI requests retain their existing token parameter and budget.
export function openAICompletionBudget(model: string, maxTokens: number, effort: ModelInput["reasoning_effort"] = "low"): Pick<ChatCompletionCreateParamsNonStreaming, "max_tokens" | "max_completion_tokens" | "reasoning_effort"> {
  if (/^gpt-(?:6-(?:astra|sol|luna)|6\.1-sol)(?:-\d{4}-\d{2}-\d{2})?$/.test(model)) return {
    max_completion_tokens: maxTokens + (effort === "high" ? 16384 : effort === "medium" ? 8192 : 4096),
    reasoning_effort: effort,
  };
  return { max_tokens: maxTokens };
}
import { supportsObservationSchema } from "./observationFormat.js";
import Anthropic from "@anthropic-ai/sdk";
import { GoogleGenAI } from "@google/genai";
import { config, modelSelection } from "../config.js";
const clients = new Map<string, OpenAI>();
let anthropic: Anthropic | undefined;
let google: GoogleGenAI | undefined;
export const complete: Complete = async (input) => {
    const selected = modelSelection(input.provider, input.model_id);
    const provider = selected.provider;
    const model = selected.model_id;
    if (config.mock) {
        const value = input.json
            ? JSON.stringify({
                summary: "Demo mode: frames have not been analyzed.",
                guidance: "Configure an AI provider to enable visual guidance.",
                status: "ok",
                steps: [],
            })
            : "Demo mode is enabled. The guidance document is available for manual review; visual analysis requires an AI provider.";
        input.onDelta?.(value);
        return value;
    }
    const key = provider === "openai"
        ? config.keys.openai
        : provider === "qwen"
            ? config.keys.hf
            : provider === "anthropic"
                ? config.keys.anthropic
                : provider === "google"
                    ? config.keys.google
                    : "local";
    if (!key)
        throw Object.assign(new Error(`Configure ${provider} credentials in backend/.env, or select an available provider.`), { statusCode: 503, code: "provider_unconfigured" });
    const signal = input.signal || AbortSignal.timeout(45000);
    signal.throwIfAborted();
    const maxTokens = input.maxTokens || 1800;
    if (provider === "openai" || provider === "qwen") {
        let client = clients.get(provider);
        if (!client) {
            client = new OpenAI({
                apiKey: key,
                timeout: 45000,
                maxRetries: 0,
                ...(provider === "qwen"
                    ? {
                        baseURL: process.env.QWEN_API_URL || "https://router.huggingface.co/v1",
                    }
                    : {}),
            });
            clients.set(provider, client);
        }
        const content: ChatCompletionContentPart[] = [
            { type: "text", text: input.prompt },
            ...input.frames.map((frame) => ({
                type: "image_url" as const,
                image_url: {
                    url: `data:image/jpeg;base64,${frame.toString("base64")}`,
                    detail: input.vision_detail || "auto",
                },
            })),
        ];
        const args: ChatCompletionCreateParamsNonStreaming = {
            model,
            messages: [
                ...(input.systemPrompt
                    ? [{ role: "system" as const, content: input.systemPrompt }]
                    : []),
                { role: "user", content },
            ],
            ...(provider === "openai" ? openAICompletionBudget(model, maxTokens, input.reasoning_effort) : { max_tokens: maxTokens }),
            ...(input.json && provider === "openai"
                ? {
                    response_format: input.responseFormat && supportsObservationSchema(model)
                        ? input.responseFormat
                        : { type: "json_object" },
                }
                : {}),
        };
        if (input.onDelta) {
            const stream = await client.chat.completions.create({ ...args, stream: true }, { signal });
            let text = "";
            for await (const chunk of stream) {
                const delta = chunk.choices[0]?.delta.content || "";
                text += delta;
                if (delta)
                    input.onDelta(delta);
            }
            return text;
        }
        const result = await client.chat.completions.create(args, { signal });
        return result.choices[0]?.message.content || "";
    }
    if (provider === "anthropic") {
        anthropic ||= new Anthropic({ apiKey: key, timeout: 45000, maxRetries: 0 });
        const content: Exclude<MessageParam["content"], string> = [
            { type: "text", text: input.prompt },
            ...input.frames.map((frame) => ({
                type: "image" as const,
                source: {
                    type: "base64" as const,
                    media_type: "image/jpeg" as const,
                    data: frame.toString("base64"),
                },
            })),
        ];
        if (input.onDelta) {
            const stream = await anthropic.messages.create({
                model,
                max_tokens: maxTokens,
                system: input.systemPrompt,
                messages: [{ role: "user", content }],
                stream: true,
            }, { signal });
            let text = "";
            for await (const event of stream) {
                if (event.type === "content_block_delta" &&
                    event.delta.type === "text_delta") {
                    text += event.delta.text;
                    input.onDelta(event.delta.text);
                }
            }
            return text;
        }
        const result = await anthropic.messages.create({
            model,
            max_tokens: maxTokens,
            system: input.systemPrompt,
            messages: [{ role: "user", content }],
        }, { signal });
        return result.content
            .filter((c) => c.type === "text")
            .map((c) => (c.type === "text" ? c.text : ""))
            .join("\n");
    }
    if (provider === "google") {
        google ||= new GoogleGenAI({
            apiKey: key,
            httpOptions: { timeout: 45000 },
        });
        const result = await google.models.generateContent({
            model,
            contents: [
                {
                    role: "user",
                    parts: [
                        { text: input.prompt },
                        ...input.frames.map((frame) => ({
                            inlineData: {
                                mimeType: "image/jpeg",
                                data: frame.toString("base64"),
                            },
                        })),
                    ],
                },
            ],
            config: {
                maxOutputTokens: maxTokens,
                systemInstruction: input.systemPrompt,
                abortSignal: signal,
                ...(input.json ? { responseMimeType: "application/json" } : {}),
            },
        });
        signal.throwIfAborted();
        const text = result.text || "";
        input.onDelta?.(text);
        return text;
    }
    const response = await fetch(`${config.keys.localEndpoint}/api/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal,
        body: JSON.stringify({
            model,
            prompt: input.prompt,
            system: input.systemPrompt,
            images: input.frames.map((f) => f.toString("base64")),
            stream: false,
            format: input.json ? "json" : undefined,
            options: { num_predict: maxTokens },
        }),
    });
    if (!response.ok)
        throw new Error(`Local model returned HTTP ${response.status}`);
    const body = (await response.json()) as { response?: string };
    const text = body.response || "";
    input.onDelta?.(text);
    return text;
};
