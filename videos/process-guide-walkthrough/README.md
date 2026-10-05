# Process Guide narrated walkthrough

A 90-second, 1920×1080 instructional video using the real local application. The source app's existing silent 20-second quick tour is preserved.

## Artifacts

- `renders/process-guide-walkthrough.mp4`: final H.264/AAC video (30 fps, fast start).
- `process-guide-walkthrough-poster.jpg`: still from the actual rendered video.
- `process-guide-walkthrough.vtt`: optional English captions. Narration captions are already burned into the MP4, so players should default this track to off.
- `process-guide-walkthrough.json`: eight authored chapters and a measured sentence-level transcript. Chapter seek times are real timeline positions.
- `capture-meta.json`: actual browser target rectangles, screenshot dimensions, capture provenance, and page errors.
- `timeline-plan.json`: exact scene, voice, and highlight timing.
- `check.json`, `keyframes.json`, `keyframe-proof.png`: HyperFrames checks and motion proof.
- `verification.json`: final encode, size, hash, and quality checks.

Studio: http://localhost:3018/#project/process-guide-walkthrough

## Reproduce

Use Node 24.18.0 and FFmpeg/ffprobe. Project scripts pin HyperFrames 0.8.127. Fonts and GSAP are frozen locally.

1. Build the app from `guidance-app/` with `npm run build`.
2. From this directory, run `fnm exec --using=24.18.0 node --import ../../backend/node_modules/tsx/dist/loader.mjs capture.mts`. The helper opens an isolated app on port 8105 and an in-memory account database; it closes both afterward.
3. Reuse the frozen voice files. To create new takes, edit `script.json`, remove the MP3 files for the changed line IDs from `assets/voice/`, start the real app on port 8101 and run `node generate-voice.mjs`. Existing MP3 files are reused; deleting a take is the explicit regeneration step. The helper makes TTS requests through that app's configured `/api/tts`; credentials are not embedded in this project.
4. Run `node build.mjs`. It derives crops from capture metadata, measures the mildly sped-up speech (1.10×), and distributes the remaining time into readable holds. Total duration is exactly 90 seconds.
5. Run `npx hyperframes check --samples 20 --json` and inspect keyframe snapshots.
6. Run `npx hyperframes preview --background --port 3018`.
7. Run `npx hyperframes render --quality delivery --crf 20 --workers 6 --output renders/process-guide-walkthrough.mp4`.

## Capture and content scope

Screens are captured from the actual app after the professional report/account build. Parts_Sorting.txt and parts-sorting.mp4 are the prepared example assets. The capture performs real document loading, operator confirmation, job-context save, evidence bookmark, exception creation, PDF preparation, account creation, and result save.

The backend is isolated with a deterministic engine and an in-memory account store. Structured document parsing needed no fixture model calls in the final capture. No paid visual detection, camera/microphone access, question submission, report upload, or native share action is triggered by the helper. The walkthrough is a demonstration of app controls, not a claim about detection accuracy. The simulator is planned and inactive. Accounts remain local to this deployment until it is hosted.

The narration is AI-generated using the already configured local application's OpenAI TTS provider (nova). There is no music bed. Narration is timed using measured audio files; transcript windows are sentence/chunk windows, not fabricated word alignments.

No project or artifact was published externally.
