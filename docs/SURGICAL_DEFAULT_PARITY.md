# Original surgical sample compatibility

The independent app now includes the original default video and its unchanged surgical instructions. This review verifies the source, extraction, playback, guidance routing, questions, evidence and report flows. It does not establish identical outputs from different AI models or clinical accuracy.

## Original source

The original sample README and backend select `AI-Proctor/sample-data/Uncomplicated cholecystectomy (3).zip` by default, paired with `AI-Proctor/llmDescription/Cholecystectomy.txt`. Its video member is `videos/c5505f15-83c3-4a44-b525-1dedf474d553.mp4`.

The unchanged video is available as `sample-videos/uncomplicated-cholecystectomy.mp4`: 37,894,412 bytes, SHA-256 `41eff5c46aec953cbabe7861213fb7d7c30a6f0c702066034623630b61a0e1fd`, 252.766667 seconds, 660×540, 30 fps, H.264 with no source audio. It depicts simulated surgical training. The seven original TXT files remain byte-identical in `guidance-library/`.

Choose **Uncomplicated cholecystectomy — Original default** on the intro or in Sources. This stages a disposable session copy and loads `Cholecystectomy.txt` automatically. The immutable default and original project are preserved.

## Compared behavior and corrections

| Flow                           | General app result                                                                                                   | Verification                                                       |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| Default video and instructions | Original media/TXT, six parent surgical steps; no upload required to select them                                     | Hash, byte identity, catalog/load/range API tests                  |
| Instruction extraction         | Bare headings, complete actions, tools, quantities, criteria and principles retained                                 | Actual TXT parser tests and browser checks                         |
| Multi-line constraint          | Both continuation lines are retained with their heading                                                              | Regression against the actual surgical document                    |
| Duct/artery subsections        | Both 7A and 7B remain in the six-step workflow; 7B is no longer lost under duration                                  | Parser/browser regression                                          |
| Caution versus completion      | The document's stop caution is a principle rather than visual proof                                                  | Parser regression; original TXT unchanged                          |
| Playback and seeks             | Original H.264 decodes and seeks in Chrome/WebKit, including phones/tablets                                          | Production sample at 216 s, fixture workflow at 30 s               |
| Guardian after a seek          | Four decoded frames span the full configured server window immediately, rather than one newly captured browser frame | Actual increasing 25–30 s timestamps, real server-frame count      |
| Q&A/voice route                | Same instructions and source reach typed/streaming questions; uploaded blob playback uses its known server copy      | Source-owned request and streaming-contract tests                  |
| Observation context            | Unrelated older AI scene descriptions are excluded; explicitly requested history remains available                   | Current-window and rewind regressions                              |
| Progress                       | Fresh, independently captured visual corroboration; manual confirmation remains labelled                             | Negative/duplicate/contradictory evidence, rewind and manual tests |
| Guardian findings              | Current-frame watches/alerts retained with timestamps and source/reference provenance                                | Review tests and real-library browser flows                        |
| Incident clips/report          | Explicit source-owned preparation, accurate start/duration, preview/download/share, retained decision index          | Real original-surgical MP4 clip plus cache/range/browser/PDF tests |

The original TXT parser lost fields when headings lacked colons, and the specialized hardcoded stage data introduced or dropped some criteria. Those defects were not copied. The general app uses the supplied TXT, keeps conservative evidence rules, and does not confirm unseen earlier work merely because a later scene is visible.

## Intentional differences

The original safety monitor used a separate short Claude response and specialized simulator checks. General Guardian combines observation, guidance and workflow evidence in one structured request. GPT-4o is now the tested default; alternative models, including GPT-4o mini, remain selectable. The original single-response/sticky completion behavior is replaced by fresh corroboration and labelled manual confirmation. These differences mean exact algorithm/output/latency equivalence is not claimed.

Simulator telemetry remains a planned adapter, as requested when designing the general app. The original CSV-driven phase classifier and telemetry tripwire are not active and are not represented as visual evidence. Camera/screen guidance preserves captured frames; it does not automatically record continuous footage for incident clips.

## Evidence and limits

- [Consecutive real-provider runs](surgical-default-model-comparison.json) retain all four complete nine-request runs, not a selection of the best answers. Three moments were sampled: visible tools at 12 s, smoke/haze at 105 s, and clips at 216 s. The latest run recognized the clipping stage and withheld proof of earlier safety criteria. Some anatomical/tool-mode claims still exceed what these images establish.
- [Latest raw answers](surgical-default-live-validation.json) contain observations, criterion states, question answers, timings, cached repeat and restored progress after rewind. These are software smoke checks, not expert clinical annotations or a full-video accuracy metric.
- [Browser regressions](report-browser-validation.json) exercise the real sample, preserved TXT, immediate post-seek server window, streaming Q&A, explicit manual confirmation, actual captured frame and Guardian media cleanup. Deterministic provider responses establish routing and UI behavior.
- [Production profiles](surgery-production-smoke.json) verify the compiled app at desktop, phone and tablet sizes, actual video decoding, unchanged instructions, six initially unconfirmed steps and no overflow/errors. Automatic requests were explicitly forced to demo for these captures.
- [Report and clip verification](professional-report-validation.json) documents native/offline exports, duration/size guards, bounded caches, rendering stress and visual inspection. Saved/shared PDF/HTML include the finding index; downloaded MP4s are attached separately.

Full surgical recognition, hazard sensitivity/specificity, calibrated confidence, physical microphone/camera performance and operational/clinical validation require independently expert-labelled footage and hardware testing. The previous 85-case synthetic benchmark remains historical and was not rerun for these prompt changes.

Reproduce the opt-in paid check from `backend` with `fnm exec --using=24.18.0 node --import tsx scripts/surgery-parity-smoke.mts --live --model gpt-4o`. Model image input and structured-output support are documented in [official OpenAI documentation](https://developers.openai.com/api/docs/models/gpt-4o). The compiled production UI check is `node --import ./backend/node_modules/tsx/dist/loader.mjs scripts/surgery-production-smoke.mts` from the app root; it makes no paid model calls.
