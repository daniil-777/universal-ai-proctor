# Original app analysis and adaptation

The original project combines a Python prototype and a React/Node web MVP. The web app loads video, samples frames or mosaics, sends reference text and recent history to vision language models, answers questions, speaks responses, logs Guardian observations, and presents workflow stages, principles, prompts, logs, metrics, and reports. Its simulation path loads bundles and MQTT telemetry and maps them to surgical stages.

The original interface contained hardcoded surgical examples and demo progress. Some visible actions, including comparison/export and localization examples, were placeholders. Those are unsuitable as general process evidence. The new app uses structured document extraction, provisional visual discovery, actual provider responses, explicit evidence states, and measured performance instead.

| Capability | Independent app behavior |
| --- | --- |
| Familiar interface | Teal/navy theme, left setup panel, central video and overlays, right tabbed guidance panel, resizable columns, Guide/Engineer modes, floating chat. |
| Video | Immediate local preview, background server copy, playback, seeking, frame stepping, zoom, server range streaming and incident clips. |
| Live input | Camera and screen sharing with browser permission handling and stream cleanup. |
| Document | TXT/MD/CSV/TSV upload, local extraction, ordered editable actions/criteria/tools, raw editor, optional explicit AI refinement, CSV export, all seven original TXT files retained. |
| No document | Vision proposes provisional steps from visible input; video overview is used for discovery only. |
| Progress | Evidence-based criterion status and progress, distinct confidence display, repeated observations, manual confirmation, rewind restoration and source resets. |
| Principles | Extracted document principles plus the principle from the latest observation; no default unrelated surgical principles. |
| Guardian | Continuous observation, history, concern overlays, optional speech, configurable timing/model/window/frame count, proportional message resizing. |
| Chat and voice | Streaming answers, captured frames and exact prompts, sampling/overview, wake words, spoken answers, interruption, compact history, popped-out chat sharing the actual session. |
| Recording | Screen/session recording with microphone and synthesized-answer audio mix, local voice notes and replay. |
| Engineering | Sampling/mosaic, compression, selected analysis region, model choice, actual observation JSON, prompts, logs, parameters and measured latency. |
| Comparison/export | Real parallel provider comparison without altering progress; ZIP containing workflow, observations and source text. |
| Reports | Evidence summary, labeled completion provenance, question history, alert clips, printable HTML/PDF. No fabricated simulator measurements. |
| Simulator | Explicit planned tile and typed future adapter; unavailable routes return 501. |

Implementation boundaries: `domain/guidance.ts` handles documents and schemas, `domain/progress.ts` handles confirmation rules, `domain/session.ts` isolates bounded sessions, `pipeline/guidance.ts` handles visual lifecycle/cache/stale-result protection, `llm/client.ts` handles provider transport, and `app.ts` exposes the local API. The frontend shares an isolated session through `api.ts`, restores server state with `guidanceState.ts`, and coordinates one observation loop in `useGeneralGuidance.ts`.

Simulation-only telemetry and metric classification are deliberately reserved for the later adapter, as requested. Original source files were not changed by this generalization.

The later critical review adds responsive phone/tablet layouts, camera recording fallback, strict evidence/request contracts and annotated answer evaluation. See [CRITICAL_REVIEW.md](CRITICAL_REVIEW.md), [VALIDATION.md](VALIDATION.md), and [evaluation protocol](../evaluation/README.md).
