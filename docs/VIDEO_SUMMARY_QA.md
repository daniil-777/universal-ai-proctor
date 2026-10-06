# Video recap and narration QA

The isolated browser harness uses the production routes, summary manager, timestamped FFmpeg decoder and frontend. The source is an 18-second, 640×360 generated `testsrc2` clip. All model descriptions are deterministic fixtures, every job has `provenance.simulated=true`, and the optional TTS response is an actual short PCM tone. This checks decoding, contracts, state and audio transport; it does not establish real AI recognition or spoken-voice quality.

Provider keys are cleared before application imports. The server binds only 127.0.0.1:8115 (or 8116), uses an in-memory account store and its own temporary upload directory, and intercepts TTS locally. Fixture controls are owned by a separate HTTP wrapper, never registered in the production backend. It cleans only its own temporary files on shutdown. No old deployed API or real account is used.

Run after a production frontend build, using Node 24, FFmpeg and the installed Chrome/WebKit engines:

```sh
cd frontend
node node_modules/@playwright/test/cli.js test --config ../scripts/video-summary-qa.playwright.config.ts
```

Output paths default to `os.tmpdir()` and can be set with `VIDEO_SUMMARY_QA_OUTPUT` and `VIDEO_SUMMARY_QA_RESULTS`. The test creates and removes its own synthetic decoder clip. There are no automatic retries, forced clicks, substituted success responses, suppressed page errors or existing documentation screenshot replacements.

## Independent browser coverage

- Surgery, construction, manufacturing, dance and meeting operator selections; cited domain metrics, an unseen selected metric that stays unavailable, missing audio, measured technical facts and estimated record counts. Explicit synthetic meeting transcripts exercise speech citations without claiming that the silent source was transcribed.
- Repeated episode evidence retained in the audit while episode totals deduplicate and intervals use unions.
- Detailed precision review can remove primary findings; removed process evidence stays unavailable. Balanced mode uses its advertised windows and frame limit without a precision pass.
- Failed windows remain explicit; manual retry reuses successful windows. Foreign frame references, out-of-window timestamps and foreign metric IDs cannot become accepted evidence.
- Cancellation, changed source/instructions and wrong-reference retries; no workflow confirmation changes. Large uploaded TXT survives intact while model context remains bounded.
- Job-pinned JSON download and immutable saved result after later instruction edits.
- A completed no-TXT recap keeps its input snapshot when automatic guidance is started. Only an ordinary click on **Resume guidance** releases recap ownership; narration stops, reopening does not reacquire ownership, and the pinned JSON remains available.
- Actual video end waits for analysis completion before opening the recap. Narration waits until its accepted window is in the past; disable, seek and source replacement prevent stale audio.
- Chrome desktop and 320px phone; WebKit 820px tablet and 390px dark phone. Phone checks use 200% root text, ordinary clicks, keyboard evidence activation and Escape. Captures cover options, final result and evidence.
- Full title, footer controls and Close stay reachable with native scrolling at enlarged phone text; the 320px case also checks a 480px-tall window.

Every case attaches browser diagnostics: page errors, console errors/warnings, HTTP errors and failed requests. Recognized native aborts of obsolete plan/job/source/reference/TTS/analysis requests and native blob-media reads remain in the artifact with an explicit expected reason; unexpected failures fail the case. The exact WebKit message that the Chrome `interactive-widget` viewport directive is ignored is retained as a known compatibility diagnostic; the app has a visual-viewport fallback. Other console errors remain failures, and warnings remain recorded. Intentional 409 responses for invalid downloads and stale retries are asserted through the API request context.

Set `VIDEO_SUMMARY_QA_AXE` to an isolated `axe.min.js` path to run axe scoped to `.video-recap-dialog` for WCAG 2 A/AA and 2.1 AA on options, result and evidence in all four profiles. Violations fail; incomplete checks remain attached for human review. No dependency or machine-specific tool path is committed. Without this optional tool, the native label/role, progress, keyboard and geometry assertions still run, and the artifact explicitly records that an automated accessibility audit was not performed. Neither route claims complete accessibility conformance.

A page error or confirmed overflow remains a failure; no approved visual baseline is present, so screenshots receive direct review rather than a claimed visual regression score.

## Execution results — 6 October 2026

The production frontend remained unchanged during the final runs (`Workspace-_j2knZ4d.js`, `index-C_VryRUa.js`). The fixture used Node 24.18.0, actual FFmpeg decoding, installed Chrome/WebKit and isolated axe-core 4.10.3.

The fresh 27-case run completed **25 passes and two diagnostics-only failures**: WebKit logged its unsupported `interactive-widget` viewport directive. All behavior assertions in those two cases completed. After explicitly classifying and retaining that exact compatibility message, the two WebKit reruns produced **one pass and one diagnostics-only failure**: an ordinary setup pause canceled the existing `/api/guidance/analyze` request, whose nested path was missing from the obsolete-request classification. Adding that exact route produced a **passing final tablet rerun**. No product changes, forced clicks, suppressed native messages or frontend rebuilds were made between these runs. These results validate **27 unique browser scenarios**; reruns are not counted as additional scenarios.

The final result has zero page errors, HTTP errors or unexpected network failures. Known native cancellation records and WebKit compatibility/preload messages remain attached. All **12 scoped axe scans** in the fresh matrix reported **zero violations**. Remaining incomplete results concern contrast on offscreen or partly clipped content. Four explicitly computed foreground/surface contrast pairs per result, including alpha surface compositing, had minimum ratios **5.62:1 in light mode** and **7.82:1 in dark mode**. These checks do not establish complete accessibility conformance.

Actual timed TTS requests and native audio playback were verified with the synthetic PCM tone: audio starts only after an accepted window ends; disabling narration prevents another request; delayed synthesis is canceled after seeking/source replacement without audible or browser-speech fallback output. This does not test production voice quality. The fixture made **zero real provider calls**.

Machine-local result files (ephemeral artifacts, not repository assets):

- `/private/tmp/cueveris-video-summary-final27-results.json` — fresh full matrix and attachments.
- `/private/tmp/cueveris-video-summary-webkit-rerun-results.json` — two targeted diagnostics reruns.
- `/private/tmp/cueveris-video-summary-tablet-final-results.json` — final passing tablet check.
- `/private/tmp/cueveris-video-summary-final27-summary.json` — aggregate diagnostics, scoped axe and contrast data from the fresh matrix.
- `/private/tmp/cueveris-video-summary-final27/` and `/private/tmp/cueveris-video-summary-tablet-final/` — screenshots and applicable traces. Phone captures include title, footer, evidence and the 320×480 short window at 200% text.

The parent release validation additionally reported **416 backend + 246 frontend unit tests (662 total)**, **12 packaging checks**, **51 existing browser regressions** (20 report, 14 editor, 4 goals, 13 voice) and **four static-preview browser checks** passing. Its two static-preview axe profiles reported zero violations with incomplete ARIA/contrast checks recorded separately; the limited static CSS-pair minima were 5.35:1 light and 7.85:1 dark. These parent results are separate from the 27 recap scenarios.

The bounded real-source evaluator's final offline preflight verified five licensed source/anchor/hash cases and made zero provider calls (`/private/tmp/cueveris-video-summary-preflight-final.json`). A paid recognition/voice-quality evaluation was not run, and no real-model accuracy score is claimed.

## Bounded real-source evaluation

`scripts/evaluate-video-summary.mjs` defaults to an offline preflight. It validates exact source SHA256 and the frozen v2 recognition bank, records original license/source links, and makes zero provider calls:

```sh
node scripts/evaluate-video-summary.mjs --out /tmp/cueveris-recap-preflight.json
```

The five existing licensed domains are construction, manufacturing, surgery, dance and sports. There is no licensed meeting/transcript ground truth in this repository. A live run is deliberately separate and requires `--run-live`, an explicitly configured loopback backend, `--provider`, `--model` and `--max-model-calls 40`. It prepares one 12-second excerpt around a frozen anchor per domain, uploads the actual excerpt/reference, preflights every job before spending work, reserves the two-attempt retry budget and analyzes sequentially without audio. No live run is authorized or executed as part of the simulated browser suite.

The stage-recognition anchors are not exhaustive whole-video/count ground truth. The script preserves raw jobs, measured latency, failed intervals and a required manual-review field; it produces no invented accuracy score or safety certification. Human review must assess unsupported assertions, citations, edited-scene uncertainty and timestamp alignment. Exact counts are scored only where a separately reviewed continuous interval makes every event observable; hidden measurements and unsampled fast movement must remain unavailable.

## Primary implementation references

[Gemini video understanding](https://ai.google.dev/gemini-api/docs/video-understanding) describes sampling, clipping and video/audio inputs. Sparse sampling can miss fast actions; a sample-based recap should expose its limitations and cite source timestamps. [Gemini structured output](https://ai.google.dev/gemini-api/docs/structured-output) provides schema-constrained JSON, which still requires application validation of values, references and temporal bounds. [Gemini Live API](https://ai.google.dev/gemini-api/docs/live-api) supports streaming interaction, a different transport from uploaded-video end-to-end analysis.

[Teams intelligent recap](https://learn.microsoft.com/en-us/microsoftteams/intelligent-recap-calls-meetings) and [Teams recap](https://support.microsoft.com/en-us/teams/meetings/recap-in-microsoft-teams) provide useful patterns for chapters, tasks and jumping to retained meeting evidence. Their meeting/transcript features are UX references; they do not validate physical action counts or process conformance in other domains.
