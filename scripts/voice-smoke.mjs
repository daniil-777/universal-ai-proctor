// Run against the running app: npm run verify:voice. Uses the configured real
// providers; recognition events are simulated, microphone accuracy is excluded.
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
const root = fileURLToPath(new URL("../", import.meta.url));
const require = createRequire(path.join(root, "frontend/package.json"));
const { chromium } = require("playwright");
const browser = await chromium.launch({ channel: "chrome" });
const results = [];
const cases = [
  { video: "parts-sorting.mp4", document: "Parts_Sorting.txt", time: 9, question: "Hey, what is visible, and what should I check before moving the next part?" },
  { video: "packaging-portrait.mp4", document: "Packaging.txt", time: 4, question: "Hey, what can you see, and what is the next documented action?" },
  { video: "parts-sorting.mp4", time: 4, goals: "Guide me in simple language. Explain what is visible before suggesting a check.", question: "Hey, describe what is visible, then tell me what to check next." },
];
try {
  for (const scenario of cases) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    const page = await context.newPage(), errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.addInitScript(() => {
      const probe = { events: [], answer: "", quality: "", ask: () => {} };
      window.__voiceProbe = probe;
      const record = (kind, extra = {}) => probe.events.push({ kind, at: performance.now(), ...extra });
      const recognizers = [];
      class Recognition {
        constructor() { recognizers.push(this); }
        start() { this.onstart?.(); record("listening"); }
        stop() { this.onend?.(); }
        abort() {}
      }
      window.SpeechRecognition = window.webkitSpeechRecognition = Recognition;
      probe.ask = text => {
        record("recognized");
        const r = recognizers.at(-1);
        r.onresult?.({ resultIndex: 0, results: { 0: { 0: { transcript: text, confidence: 1 }, length: 1, isFinal: true }, length: 1 } });
        r.onend?.();
      };
      const NativeAudio = window.Audio;
      window.Audio = function (...args) {
        const el = new NativeAudio(...args);
        for (const kind of ["playing", "ended", "error"])
          el.addEventListener(kind, () => { if (el.src.startsWith("blob:")) record(kind); });
        return el;
      };
      window.Audio.prototype = NativeAudio.prototype;
      const nativeFetch = window.fetch;
      window.fetch = async (...args) => {
        const url = String(args[0]);
        if (url.endsWith("/api/tts")) {
          const text = JSON.parse(args[1].body).text;
          record("ttsStart", { text });
          const response = await nativeFetch(...args);
          await response.clone().blob();
          record("ttsReady", { text, ok: response.ok });
          return response;
        }
        const response = await nativeFetch(...args);
        if (url.endsWith("/api/llm/ask/stream") && response.body) {
          const reader = response.clone().body.getReader(), decoder = new TextDecoder();
          void (async () => {
            let buffer = "", first = true;
            while (true) {
              const { done, value } = await reader.read(); if (done) break;
              buffer += decoder.decode(value, { stream: true });
              const parts = buffer.split("\n\n"); buffer = parts.pop() || "";
              for (const part of parts) {
                const line = part.split("\n").find(l => l.startsWith("data:")); if (!line) continue;
                const payload = JSON.parse(line.slice(5));
                if (payload.delta) { probe.answer += payload.delta; if (first) { first = false; record("firstToken"); } }
                if (payload.done) { probe.quality = /Latest image quality: (\w+)/.exec(payload.prompt || "")?.[1] || ""; record("done"); }
                if (payload.error) record("streamError", { error: payload.error });
              }
            }
          })().catch(error => record("streamError", { error: String(error) }));
        }
        return response;
      };
    });
    await page.goto(process.env.GUIDANCE_APP_URL || "http://localhost:8101/");
    if (scenario.goals) {
      await page.getByRole("button", { name: "Guidance goals", exact: true }).click();
      await page.getByLabel("Your wishes for this session").fill(scenario.goals);
      await page.getByRole("button", { name: "Save goals" }).click();
    }
    await page.getByTestId("intro-video-input").setInputFiles(path.join(root, "evaluation/assets", scenario.video));
    if (scenario.document) {
      await page.getByTestId("intro-document-input").setInputFiles(path.join(root, "evaluation/assets", scenario.document));
      await page.getByText(new RegExp(scenario.document + " · ")).waitFor();
    }
    await page.getByRole("button", { name: "Open workspace" }).click();
    await page.getByRole("button", { name: "Pause guidance", exact: true }).click();
    await page.locator(".workspace-video video").evaluate(async (el, seconds) => {
      el.pause();
      if (Math.abs(el.currentTime - seconds) < 0.01) return;
      await new Promise(resolve => { el.addEventListener("seeked", resolve, { once: true }); el.currentTime = seconds; });
    }, scenario.time);
    await page.getByRole("button", { name: "Open chat" }).click();
    await page.locator(".chat-panel").getByRole("button", { name: "Listen", exact: true }).click();
    await page.evaluate(text => window.__voiceProbe.ask(text), scenario.question);
    await page.waitForFunction(() => window.__voiceProbe.events.some(e => e.kind === "playing"), null, { timeout: 60000 });
    await page.waitForFunction(() => {
      const events = window.__voiceProbe.events;
      return events.some(e => e.kind === "done") && events.filter(e => e.kind === "ended").length === events.filter(e => e.kind === "ttsStart").length;
    }, null, { timeout: 60000 });
    const probe = await page.evaluate(() => ({ events: window.__voiceProbe.events, answer: window.__voiceProbe.answer, quality: window.__voiceProbe.quality }));
    const event = kind => probe.events.find(e => e.kind === kind);
    const started = event("recognized").at, firstTts = event("ttsStart"), ready = probe.events.find(e => e.kind === "ttsReady" && e.text === firstTts.text);
    const done = event("done").at, playing = event("playing").at;
    const ended = probe.events.filter(e => e.kind === "ended"), played = probe.events.filter(e => e.kind === "playing");
    const result = {
      ...scenario, answer: probe.answer, current_view_quality: probe.quality,
      recognized_to_first_token_ms: Math.round(event("firstToken").at - started),
      recognized_to_answer_complete_ms: Math.round(done - started),
      recognized_to_audio_ms: Math.round(playing - started),
      answer_complete_to_audio_ms: Math.round(playing - done),
      first_sentence_synthesis_ms: Math.round(ready.at - firstTts.at),
      synthesis_overlap_ms: Math.round(Math.max(0, Math.min(done, ready.at) - firstTts.at)),
      prepared_before_complete: firstTts.at < done,
      sentence_gaps_ms: played.slice(1).map((e, i) => Math.round(e.at - ended[i].at)),
      tts_requests: probe.events.filter(e => e.kind === "ttsStart").length,
      speech_provider_success: probe.events.filter(e => e.kind === "ttsReady").every(e => e.ok),
      guidance: await page.locator(".guidance-copy").innerText(),
      js_errors: errors,
      events: probe.events.map(e => ({ ...e, at: Math.round(e.at - started) })),
    };
    if (errors.length || !result.speech_provider_success || result.tts_requests > 3 || result.events.some(e => ["streamError", "error"].includes(e.kind)))
      throw new Error("Voice smoke failed: " + JSON.stringify(result));
    results.push(result);
    console.log(JSON.stringify({ video: scenario.video, document: scenario.document || null, recognized_to_audio_ms: result.recognized_to_audio_ms, overlap_ms: result.synthesis_overlap_ms, gaps_ms: result.sentence_gaps_ms }));
    await context.close();
  }
  const reportPath = path.join(root, "docs/voice-live-smoke.json");
  const previous = JSON.parse(await fs.readFile(reportPath, "utf8").catch(() => "null"));
  const previousRuns = previous ? [...(previous.previous_runs || []), { generated_at: previous.generated_at, notes: previous.notes, results: previous.results }] : [];
  await fs.writeFile(reportPath, JSON.stringify({ generated_at: new Date().toISOString(), notes: "Real running UI, live vision model and speech provider, real browser decoding/playback. Simulated recognized-transcript events; no microphone/room-echo or perceptual naturalness score. Overlap measures synthesis time hidden by answer generation, not a measured old-app comparison. Previous runs are retained, not replaced by best answers.", results, previous_runs: previousRuns }, null, 2) + "\n");
} finally { await browser.close(); }
