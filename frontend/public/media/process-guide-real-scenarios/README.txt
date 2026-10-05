PROCESS GUIDE — REAL 2–3 MINUTE VIDEO LIBRARY

HOW TO USE
Open http://localhost:8101 and choose a real video from the sample-video menu. It loads the matching reference automatically. Alternatively upload an MP4 and the TXT with the same scenario name. Steps and principles appear in the guidance workspace.

The five guidance documents are original observation references written after reviewing the actual footage and its source context. Timestamps are approximate review anchors, not automatic completion. The guides separate visible actions from measurements, approval, comfort, clinical outcomes and off-camera activity.

CONTENTS
House construction — SIP assembly — 3:00 — 1920x1080 — 6 steps
Manufacturing — tool and mould production — 2:55 — 1920x1080 — 6 steps
Surgery — published laparoscopic footage — 3:00 — 480x272 — 7 steps
Dancing — tap footwork — 2:03 — 428x240 — 8 steps
Sport — EZ and straight-bar curls — 2:53 — 1920x1080 — 5 steps

NOTES
House: source 01:20–04:20, original timelapse/editing preserved.
Manufacturing: full company film, multiple jobs and montage cuts.
Surgery: first 180 seconds of published real operative footage; educational observation with surgeon review. No audible narration. Native source is 480x272.
Dancing: full tap-footwork source; upper body largely cropped, native428x240. Playable packet timeline differs slightly from container duration tag.
Sport: full official Commons1080p derivative after original download was rate-limited; explanation and demonstration scenes are distinguished in the guide.

No video is looped, stretched, generated or artificially upscaled. Native high-resolution downloads can be large. The gallery uses metadata-only preload; individual files can be downloaded separately.

VERIFICATION
All five references parse with the app parser into incomplete steps and unknown criteria. Source author, license and change records are retained. Clips are H.264/AAC browser-compatible MP4s; full decoder, app catalog/loading, streaming and responsive browser results are recorded in qa/evidence as available. These checks are not a benchmark of AI accuracy or clinical validation.

Original default surgical guidance and the earlier generated clips are preserved. 

Read SOURCE_LICENSES.txt before redistributing, including the tap footage share-alike terms.


Recognition update — 2026-10-05
Original v1 bank, all 32 checks unchanged: prior GPT-4o 18/32 (3 frames / 1 s), GPT-6.1 Sol 25/32 (3 frames / 1 s), GPT-6 Astra 28/32 (9 frames / 8 s). Astra returned uncertainty for the four unmatched original anchors, with no wrong stage ID or request error. Models and sampling changed; this is a system improvement, not an isolated model-only comparison.
Identical SHA256-verified frozen v2 images: GPT-4o 22/32, GPT-6 Luna 28/32, GPT-6.1 Sol 30/32, GPT-6 Astra 31/32. Astra's one unmatched case is ambiguous repeated dance footwork. Both question banks and strict expected IDs are preserved. The revised v2 anchors differ from v1.
All 42 Astra Q&A answers were tested separately and reviewed against actual frames. The review found supported answers, including refusal of unsupported safety/calibration/clinical conclusions; two question/reference context issues are flagged. This task-specific review does not establish general accuracy or clinical validation. Inspect qa/astra-question-visual-review.json.
Seventeen difficult Guardian explanations per model were independently reviewed. The other fifteen explanations per model remain unreviewed; exact stage IDs alone do not establish visual correctness or step completion.
Inspect qa/model-comparison.html for every actual response, metrics, source hashes and latency caveats. A separate solo surgical production check recognized S4 in 9.2 seconds without an explicit model setting. Frontend typecheck, 133 tests and responsive model-selection checks passed; all 280 backend cases passed across the complete run and retry of one iCloud read timeout, followed by a passing complete core suite.
The app defaults to GPT-6 Astra, high detail, up to 9 images / 8 seconds. Alternative models, image budgets and compression remain selectable. Local camera capture retains short motion changes at four captures per second in a bounded 32-frame buffer.


Further reliability update — 2026-10-05
Original unchanged 32 checks: final GPT-6 Astra 29/32 raw stage IDs, 3 uncertain, 0 wrong IDs and 0 request errors (previous Astra 28/32). Revised v2: 30/32, 2 uncertain, 0 wrong IDs/errors (previous Astra 31/32). Both banks, anchors, expected IDs and raw results are preserved. The revised-bank regression is visible in the latest report.
Separate deterministic UI replay uses captured observations without new model calls: original UI 28 to 29 and v2 UI 29 to 30. The fixed gate accepts a distinctive latest phase cue citing historical contrast, without creating completion votes.
Ten uncertainty questions were retested: all answers received, zero errors, keyword proxy 1.0. This is not a semantic accuracy guarantee. The medium-reasoning probe matched 3/4 selected stages; it is not a full 32-case benchmark.
An independent review inspected 124 images for all 32 original cases: 19 distinctive phase cues, 10 compatible episodes and 3 appropriate abstentions. No admitted completed steps, invented full repetitions or clinical certification. Historical whole-shoe clearance in dance S7 remains limited; its admitted criterion progress stays unknown.
Software verification: 304 backend tests, 141 frontend tests and 4 walkthrough browser cases passed before the publishing compatibility changes. Phone/tablet/desktop checks at 320/768/1440 confirm resizing, both tours and no overflow/errors.
Camera context is bounded to 30 seconds, 64 images and 8 MiB of base64 data. Delayed warnings say Earlier view. Server-owned video avoids discarded browser JPEG captures.
See qa/recognition-update.html for full runs, independent review, hashes and latency conditions.
