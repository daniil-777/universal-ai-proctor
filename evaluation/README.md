# Prepared video / answer benchmark

Open [the live report](http://localhost:8101/evaluation). It includes current-frame thumbnails, prepared questions and expected answers, actual Guardian/listener replies, failed rules, measured latency, and downloads for the four videos and matching documents. The app's Metrics tab links to it.

| Video | Duration / viewport | Ground truth | Prepared cases |
| --- | --- | --- | --- |
| packaging-landscape.mp4 | 8 s / 960×640 | Empty BOX A → blue block → taped closed box → obstruction | 6 Guardian + 10 Listener |
| packaging-portrait.mp4 | 8 s / 480×800 | Same process, portrait viewport | 6 Guardian + 10 Listener |
| parts-sorting.mp4 | 16 s / 960×640 | Two red circles + blue square; partial sorting, wrong bin, correction, obstruction, recovery, unexpected green triangle and removal | 9 Guardian + 18 Listener |
| control-panel.mp4 | 16 s / 960×640 | PANEL B OFF/red/disconnected → connected → ON/green → connection loss → obstruction → recovery → 42 V reading | 8 Guardian + 18 Listener |

`dataset.json` contains **85 independently prepared cases: 29 Guardian and 56 Listener**. `additional-cases.mjs` defines the new questions/answers. `assets/Parts_Sorting.txt` and `assets/Control_Panel.txt` provide ordered actions, visible completion criteria, and principles. All original default guidance remains in `../guidance-library/`.

Videos are synthetic fixtures with predetermined visual states; their labels identify physical bins/device/readings rather than supplying answer captions. The two additional clips are editable HyperFrames compositions under `video-projects/`, checked for runtime, layout, and contrast before rendering. Both MP4s are H.264, 4 fps, exactly 16 seconds. The two original packaging clips are 2 fps. The runner probes each clip's actual frame rate rather than assuming a common rate. Annotations use CFR decoded-frame timestamps and exact 2-second state boundaries.

## Run and reproduce

Use Node ≥22, local FFmpeg/ffprobe, and the built backend. The four bundled MP4s work immediately.

```sh
cd guidance-app
npm run evaluate:prepare                         # regenerate packaging clips + all annotations/TXT
npm run evaluate:render-videos                   # optional: re-render the two HyperFrames clips
npm run build
npm start                                       # keep running in another terminal
npm run evaluate:live                           # real GPT-4o mini responses
npm run evaluate:live -- --model gpt-4o           # same cases, alternate configured model
node evaluation/run.mjs --answers evaluation/results/latest.json --model gpt-4o
```

The last command re-scores saved replies without another provider call; pass their actual model name. `--only <case-ID-substring>` selects a subset. Subsets merge only with results from the same dataset version/provider/model and always retain the latest answer, never the best answer. Dated JSON archives preserve prior runs; `latest.json`, `latest.html`, and `latest.csv` provide the current report. Failed calls stay in the denominator. Model comparisons use complete runs of the same dataset/rubric.

Live evaluation uses the existing server credentials and actual `/api/guidance/analyze` and `/api/llm/ask/stream` routes; it does not fabricate provider responses. It sends generated frames and the supplied test documents. Every case has a fresh isolated session and gets the current frame plus one second of trailing context. Guardian comparisons include the observed summary and concern, and additionally verify current-step agreement where annotated, provisional discovery, blocked-view status, unrelated progress, and no completion from a single observation. Listener questions send prepared recognized wake-word transcripts through the actual streaming answer route.

## Metrics and limits

Required-fact recall checks explicit facts. Targeted contradiction rules check specified wrong colors, counts, labels, states, or unsupported measurements. Rubric precision/F1 and all-rule pass rate are recorded per case. Reference-overlap F1 measures wording similarity **only**. Latency p50/p95 and Listener first-token p50 are measured from actual requests. Raw answers are retained because regex rules cannot judge every paraphrase or every possible wrong claim. A reply with no flagged contradiction can still omit a fact or contain an unlisted error.

`recognition_word_error_rate` is deliberately **null**: these clips are silent and this run uses prepared transcripts. `wordErrorRate()` is provided and tested for future recorded-speech corpora. Browser tests separately exercise wake-word stripping, ignored background speech, continuous restart, multiple questions, permission denial and stale-source cancellation with a fake recognizer; they do not measure physical microphone/transcription accuracy.

Software tests, synthetic answers, and simulator integration checks do not establish clinical accuracy, complete action coverage, or calibrated confidence. Expert annotated real-process footage and recorded speech are required to estimate those properties.

Known unusable current views are answered locally for current visual questions, avoiding a previous clear image being mistaken for now. Explicit reference questions remain available without historical images being sent as the current view; explicit historical/overview questions retain their context. These guard checks are rerun after algorithm changes; mixed executions retain per-case recording times in JSON.
