# Cueveris — Leica M10 guided study

A 63-second, 1440×900 movie showing the genuine Cueveris six-step guide, three document-based reference questions, actual production-app answers and generated app speech. The official Leica M10 film remains in a separate official YouTube player on the webpage. No Leica footage, film audio, thumbnails or extracted source frames enter this movie or its render assets.

This demonstrates document-based Q&A. It does not claim that an operator actually observed particular Leica scenes or that the application visually recognised them. All 18 criteria remain unknown and zero of six steps are confirmed. The complete genuine answers appear on screen; the exact spoken sentence excerpts are highlighted and labelled.

## Reproduction

Use Node 24, npm and FFmpeg. The UI crops, data JSON and local Inter font are stored with the source. The three app voice MP3s are immutable release assets, excluded from Git. Hydrate those source-media files before rendering a fresh clone; this uses no model calls.

```sh
# Start from the guidance-app repository root.
node scripts/download-assets.mjs --group sources --omit-archives
cd videos/cueveris-leica-workflow-demo
npm ci
npm run typecheck
npm run render
npm run poster
npm run deliver
```

`npm run studio` opens the editable Remotion composition. The lockfile pins Remotion 4.0.533. The root asset manifest verifies the downloaded MP3s by size and SHA-256. `prepare-assets.mjs /path/to/private/approved-captures` is optional: it verifies the production text-only capture protocol, creates faithful crops of the app's own UI, selects the exact app voice clips, and writes sanitised provenance. It requires the original private capture inputs and is unnecessary for rerendering the hydrated project. Raw captures stay private; session, source and request IDs are not copied into the published audit.

Delivery assets are written to `guidance-app/frontend/public/media/cueveris-leica-workflow-demo.{mp4,jpg,json,txt,vtt}`. The movie uses H.264/YUV420p at 30 fps, AAC app speech and MP4 faststart. The deliver script checks exact video frame count, dimensions, audio peak, strict full FFmpeg decoding and faststart, then saves review frames, a contact sheet, speech captions, source-asset hashes and delivery metadata.

## Scene plan

| Time | Content |
| --- | --- |
| 00:00–00:06 | Leica M10 study opening and actual six-checkpoint guide |
| 00:05.5–00:12.5 | Actual study setup, separate official-film reference card |
| 00:12–00:26 | Mechanical assembly: actual reference question, full answer and 11.448-second voice excerpt |
| 00:25.5–00:39.5 | Sensor-surface handling: actual question, full answer and 8.568-second voice excerpt |
| 00:39–00:53 | Enclosure closure: actual question, full answer and 10.56-second voice excerpt |
| 00:52.5–00:59.5 | Six guide checkpoints, three text questions, zero visual analyses and 0/6 confirmed |
| 00:59–01:03 | Closing source context and independent-study credit |

Scenes overlap by half a second. Voice plays at its natural speed, starting one second into each question scene. No music or source-film audio is mixed in.

The original closure chat screenshot clips part of its last reply, so the film retains the actual UI crop and displays the complete genuine answer separately from the screenshot. No text is painted into or substituted inside the UI image.

The captured six-checkpoint pane retains its actual extraction toast, which overlaps part of the last card. The review scene displays all six exact guide titles separately in large text. The underlying source audit confirms six unconfirmed stages and 18 unknown criteria.

The production app streamed sentences through its own speech endpoint. Browser instrumentation did not expose the original MP3 response bytes, so the same production endpoint retried identical text to produce the packaged tracks. Exact text, durations, hashes and that retry reason are recorded in `qa/source-capture-audit.json`. The film uses complete-sentence excerpts, not rewritten answers.

Source attribution is in [CREDITS.txt](CREDITS.txt). Inter uses the SIL Open Font License 1.1, preserved as `public/INTER-LICENSE.txt`. The editable source follows the ECC Remotion skill: frame-driven animation, premounted sequences, `Img`/`Audio`, local assets and a render-blocking font. Official implementation references: [Audio](https://www.remotion.dev/docs/media/audio), [render](https://www.remotion.dev/docs/cli/render), [still](https://www.remotion.dev/docs/cli/still).
