// One professional voice for guidance, Guardian and spoken answers.
import OpenAI from "openai";
import { config } from "../config.js";

let client: OpenAI | null = null;
export const TTS_VOICES = ["alloy", "ash", "ballad", "coral", "echo", "fable", "nova", "onyx", "sage", "shimmer", "verse", "marin", "cedar"] as const;

export function speechRequest(text: string, voice = config.speech.voice): OpenAI.Audio.SpeechCreateParams {
  if (!TTS_VOICES.includes(voice as typeof TTS_VOICES[number]))
    throw Object.assign(new Error("Choose a supported speech voice."), { statusCode: 400 });
  const conversational = config.speech.model.startsWith("gpt-4o-mini-tts");
  if (!conversational && !["alloy", "ash", "coral", "echo", "fable", "onyx", "nova", "sage", "shimmer"].includes(voice))
    throw Object.assign(new Error("This voice requires gpt-4o-mini-tts."), { statusCode: 400 });
  return {
    model: config.speech.model, voice, input: text, response_format: "mp3",
    ...(conversational ? { instructions: "Speak as a professional, composed process guide. Use a natural conversational tone, precise articulation and a steady, efficient pace. Keep a neutral, confident delivery with brief pauses between instructions. Preserve numbers, cautions and uncertainty. Read only the supplied words. Avoid dramatic emphasis, exaggerated enthusiasm, filler and long pauses." } : {}),
  };
}

export async function tts(text: string, voice?: string, signal?: AbortSignal): Promise<Buffer> {
  if (!config.keys.openai) throw new Error("OPENAI_API_KEY is not set");
  client ??= new OpenAI({
    apiKey: config.keys.openai,
    timeout: 15000,
    maxRetries: 0,
  });
  signal?.throwIfAborted();
  const res = await client.audio.speech.create(speechRequest(text, voice), { signal });
  const bytes = Buffer.from(await res.arrayBuffer());
  signal?.throwIfAborted();
  return bytes;
}
