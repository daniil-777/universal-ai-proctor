# Process Guide

An independent general process guidance app, adapted from the original AI Proctor interface. This repository contains its own frontend, backend, configuration and tests; the original surgical guidance files and default video are preserved.

**Public full app:** https://guide.demtsev.com/

**GitHub Pages preview:** https://daniil-777.github.io/universal-ai-proctor/

**Local full app:** http://localhost:8101

The full app runs independently of the owner's computer on an Oracle Always Free VM with HTTPS, FFmpeg and persistent account storage. Its branded address redirects to the full server; uploads and streaming go directly to that server. The Pages interface supports previews and walkthroughs and links to the full app. [Deployment details](docs/ORACLE_FREE_DEPLOYMENT.md) record the actual free micro instance and its capacity limits. AI API usage is billed separately.

## Run

Node.js 24 or newer, npm, and `ffmpeg` + `ffprobe` on PATH are required. Accounts use Node's built-in SQLite. Browser video playback works best with H.264 MP4 or WebM; other uploaded containers may require conversion before playback. Chrome and Edge support the retained wake-word voice input.

```sh
git clone https://github.com/daniil-777/universal-ai-proctor.git
cd universal-ai-proctor
npm run setup
npm run assets:download  # original samples and runtime media, verified by SHA256
cp backend/.env.example backend/.env  # only on a fresh checkout; preserve existing configuration
# Configure one provider in backend/.env.
npm run build
npm start
```

On this Mac, double-click **Start Process Guide.command** to restart the built app. Keep its terminal open. If port 8101 is occupied, stop the earlier Process Guide instance or choose another `PORT` in `backend/.env`.

For development, run `npm run dev` in `backend` and `frontend` in separate terminals. Frontend: http://localhost:8180; API: http://localhost:8101. The production backend serves the built frontend and API together on port 8101.

Provider keys remain in the ignored `backend/.env`; they are never sent to the browser. Existing local provider configuration was reused for this installation. Demo mode provides the interface without AI calls and cannot fabricate visual completion. Remote AI services receive the selected frames and reference context when analysis is enabled.

## Use

1. Choose **Uncomplicated cholecystectomy — Original default** in the sample-video menu, upload a video, connect a camera, or share a screen. The original surgical sample automatically loads its unchanged `Cholecystectomy.txt`; it does not activate simulator telemetry.
2. Optionally add a TXT, Markdown, CSV, or TSV process document. Its actions, tools, completion criteria, and principles become editable steps on the right immediately. The original seven TXT files are preserved byte-for-byte in `guidance-library/`; a coffee example demonstrates a non-surgical process.
3. Open the workspace and start guidance. Without a document, the app proposes a **provisional**, editable visual workflow. A video overview helps discover its sequence; those overview images do not count as current progress evidence.
4. Review the right-hand steps and principles. Confidence and completion progress are separate. Completion requires two high-confidence observations with visible evidence at distinct timestamps and different decoded images, or explicit operator confirmation labeled **manual**. Hidden or unobserved criteria stay unknown. Seeking backward restores the earlier evidence state; changing input resets progress and rediscoveries for inferred workflows.
5. Ask questions through typed chat or wake-word voice. Inspect actual prompts and frames in Engineer mode. Use **Ready** for job preparation and **Review** for evidence and issues. Prepare a shareable PDF, download an offline HTML report or a session ZIP, or compare providers on the same frames.

## Industry review and preparation

The first three priorities from the [industry research](docs/INDUSTRY_RESEARCH_SOURCES.md) are implemented:

- **Evidence replay:** Review shows timed observations, milestones and operator frame bookmarks, with AI/operator/system provenance. Replay moment seeks the matching uploaded video; camera records provide captured stills when available. Whole-video overviews remain separate from current evidence. Earlier-instruction records retain a visible label.
- **Exceptions and handoff:** Guardian concerns and operator-raised issues appear in an exception desk. Acknowledge, resolve with a required note, or reopen an issue; its decision history remains visible. Resolving an exception does not confirm a process step. Handoff JSON and the session ZIP preserve current context, open work and retained evidence.
- **Job readiness:** Ready shows the source and instructions, accepts work order, asset/workstation and operator labels, and provides manual checks suggested from workflow tools and principles. These are preparation records, not verification of hidden conditions. Documentless video/camera guidance remains available.

The review is scoped to the current input and bounded for responsiveness: up to 150 events, 24 thumbnails within a 512 KB image budget, 80 exceptions and 20 retained decisions per exception. Changing source clears the active review; changing instructions resets preparation checks and labels earlier-reference evidence. Retention omissions are reported. Export or save a result before the active session ends.

## Reports and saved training

Open **Report**, choose **Prepare PDF**, then download or share the prepared file. Device sharing uses the browser's file-share menu where supported; otherwise **Save to share** downloads the PDF for you to attach manually. Preparing the file first preserves the user gesture needed by mobile sharing. **Offline HTML** downloads a self-contained report with retained images, progress provenance, readiness and exception decisions. Neither export requires a new AI call. PDF work runs in a bounded worker so a large report does not block the guidance loop; canceled downloads terminate their work. Characters unavailable in the bundled PDF font, including Chinese and Arabic text, produce an explicit error directing you to Offline HTML rather than silently losing text. The optional **Prepare debrief** action summarizes the recorded session deterministically, without another AI request. A downloaded report is a sampled session snapshot, not continuous validation of the whole video.

The report starts with the session identity, confirmation origins, exact criterion counts and review priorities. Its restrained document layout uses navy, teal and ruled sections. **Timeline** plots real moments retained for the current source, with recorded/watch/alert labels and keyboard-accessible selection. **Review in video** seeks the matching uploaded video without changing recorded confirmations or making an AI request. Gaps mean unobserved intervals; the axis ends at the last retained moment, and demo/whole-video overview records are excluded. PDF and Offline HTML include the same static timeline.

Section shortcuts focus workflow, evidence, Guardian clips, decisions, preparation or the recorded debrief. Evidence photos load only when requested. Resolved decisions remain available alongside open issues. PDF and offline HTML preserve full actions, tools, principles, extraction notes, framed photographs and a Guardian finding index; long identities wrap instead of disappearing. A prepared PDF retains its recorded snapshot and shows when a refresh is needed. Export checks reject HTML/error bodies and files missing a PDF signature before offering a download. Review responses are validated before entering the interface; malformed records show an error while retaining the last valid snapshot. Fixed headers and navigation keep Close visible on phones. The report module loads only when opened.

**Guardian clip library:** the report retains current-frame AI/system **watch** and **alert** findings as potential issues for review. Choose **Prepare clip** to create a short MP4 from six seconds before through three seconds after the finding, clamped to the source video. One paused preview plays at a time; download or share the file through the device menu. Preparation uses the retained event and guarded source/reference identity, exact-frame re-encoding, cancellation, shared extraction and bounded expiring caches. Closing or replacing the source releases playback. Demo observations, whole-video overviews and operator bookmarks cannot become Guardian incident clips. Camera/screen guidance supplies captured stills; continuous footage is not recorded automatically. PDF/HTML contain a finding/timestamp/decision index; attach downloaded MP4s separately when sharing. Saved accounts retain this index, not the original video bytes.

The **Account and training** icon opens an email/password account and a private training history on this app's server. Create an account with a 12–128 character password, sign in, and choose **Save current result**. Saving the same source/reference again updates its activity rather than inflating totals, including changes to manual confirmation or rewind state. View saved steps and issues, download a PDF or Offline HTML, delete an individual result, or delete the account with a password and explicit confirmation. Saved reports use the same font fallback and actionable download timeout as the current-session report. Confirmed steps distinguish AI evidence from operator confirmation; visual checks count retained observations, not training duration or certified skill.

The training workspace separates sign-in, account statistics and saved-run cards. **View result** opens the selected run directly below its card and moves keyboard focus to its labelled inspection panel. Its criteria and outstanding issues remain visible beside the download actions. Account deletion controls are expandable and separate from routine review actions.

Accounts and saved results persist across server restarts in `backend/.data/accounts/accounts.sqlite` by default. `DATA_DIR` changes the directory; relative values resolve from the backend working directory. Up to 500 activities and 2 MB per snapshot are stored per account. Evidence photographs are excluded by default; select **Also store captured evidence images in my account** to retain them within the existing image budget. Original video/audio bytes and the original guidance file are not copied into the account, but names, workflow text, operator wishes and decisions are saved. Review that content before saving or sharing. Anonymous guidance continues to work.

Accounts are stored on the server that runs this app. Production deployment uses this same server with a persistent disk and HTTPS; see [deployment configuration](docs/DEPLOYMENT.md). Email verification and password reset are not implemented. [Account implementation notes](backend/src/account/README.md) describe storage, routes and authentication behavior.

On phones and tablets, use the source drawer and compact right panel. Video/camera stays mounted during rotation. Chat, shared chat and dialogs follow the visible screen when a software keyboard opens. Send and Listen stay beside the message input; Chat options exposes quick questions and sampling scope. Touch targets, larger text and reduced motion are supported. The source drawer contains keyboard focus and restores it on close. Mobile camera recording is available when screen capture is unsupported.

Uploaded-video frame controls use probed fps; variable-rate indices remain estimates.

Turn on **Listen**, say “Hey…” followed by your question, then pause. Spoken answers, **Read guidance aloud**, and Guardian use one AI-generated voice. A new question interrupts an answer; priority alerts finish first. Successful answers also update the lower guidance field. **Voice answers** enables speech for typed questions. The output indicator distinguishes preparation, actual speech and blocked browser sound; click or press a key if sound is blocked. A stable first sentence synthesizes silently while the answer streams, and plays only after successful completion. Failed/canceled replies are discarded. Markdown cleanup preserves numbers and mathematical notation.

Speech defaults to the low-cost `gpt-4o-mini-tts` model with Cedar and a professional delivery prompt: precise articulation, a steady pace and short pauses, while preserving numbers, cautions and uncertainty. Optional `TTS_MODEL`/`TTS_VOICE` settings in `backend/.env` configure output; `TTS_MODEL=tts-1` retains the legacy model with a compatible voice such as Nova. Browser speech is a fallback when provider synthesis fails. [OpenAI's speech guide](https://developers.openai.com/api/docs/guides/text-to-speech) documents delivery instructions and supported voices. OpenAI currently lists this TTS family for retirement on January 6, 2027; a future Realtime migration will require a different transport, rather than a model-name substitution. Physical microphone recognition, room echo and subjective naturalness require hardware/listening checks.

Open **Guidance goals** on the intro or the target icon in the workspace to tell AI Proctor your wishes for focus, explanations or language. Save applies them to Guardian and question prompts; Cancel keeps saved wishes and Clear restores standard guidance. The wishes belong to the current backend session, survive a page reload, and expire with that session (one hour idle or a server restart). They do not change document steps or confirm progress.

Drag desktop panel dividers to resize the layout. Drag the guidance area’s grip to change its width and height independently; its size is saved on this device. Its text and controls remain scrollable when reduced. Arrow keys resize the focused grip; Home or double-click resets it. Drag Guardian message corners to scale text, icons, and the box proportionally. Arrow keys resize a focused corner; Home or double-click resets it. Playback, frame stepping, zoom, voice notes, session recording, configurable observation intervals, sampling/mosaic, frame compression, and analysis-region selection remain available.

The simulator tile is intentionally a placeholder. `backend/src/integrations/simulator.ts` defines the adapter boundary for later telemetry development; current guidance does not depend on simulator data.

The intro offers a silent 20-second quick tour (178 KB, downloaded only on Play), a written quick-start guide, and a theme toggle. Choose a source, optionally add instructions, then open the workspace. The public sample library is cached between setup and the source drawer; a visible retry handles load failures. Tutorial source and reproduction instructions live in [videos/process-guide-tour](videos/process-guide-tour/README.md).

**See full walkthrough** opens a 90-second narrated guide on the intro, in desktop Help, and in phone/tablet Settings. It uses actual app captures, animated control outlines, English narration captions, eight chapters and a timestamped transcript. Opening the dialog does not start narration or download the MP4; press **Play narrated walkthrough**. Closing it, hiding the page or scrolling the video out of view releases playback. Retry and the written guide remain available if playback fails. The existing silent quick tour is preserved. The [walkthrough source](videos/process-guide-walkthrough/README.md) documents capture, voice generation and local rendering.

## Performance and architecture

React/TypeScript frontend, Fastify/TypeScript backend, and independent provider adapters. One visual call updates guidance, principles, Guardian notes, and step evidence together. Server-owned uploaded/sample videos provide a complete configurable trailing window immediately after a seek; local-only and live sources use captured browser frames. Q&A uses the same source-owned readiness rather than guessing from its playback URL. Fresh prompts exclude unrelated older scene descriptions, and speculative/self-contradictory evidence cannot vote for completion. Astra is the current default for Guardian and questions; other configured providers remain selectable. The frozen recognition reports distinguish original and revised evaluation anchors and include abstentions. These defaults improve the sampled tests, not establish medical accuracy. Frames are captured locally at up to 640 px by default or 1280 px in High detail, with a bounded camera history of up to 64 images and 8 MiB over 30 seconds and at most 9 images per request. Paused video is not repeatedly sent. Requests are canceled when source, document, timeline, goals or relevant model settings change; per-session concurrency, duplicate caching, backoff, bounded snapshots, and bounded observation history protect the app from accumulating work. The browser reuses a paused frame’s JPEG instead of repeatedly encoding it; source, playback time and output dimensions invalidate that cache. Hidden pages stop frame capture. Whole-video overviews use sparse random seeks rather than decoding the full file. Optional right-panel tools load lazily. Review metadata loads without images outside the evidence view; thumbnail retention and account snapshots have explicit size limits. PDF generation is on demand with local fonts, one active worker and at most two waiting snapshots across the server. The welcome page loads approximately 176.19 KB of app/React JavaScript and 18.07 KB of CSS after gzip compression. The workbench is a separate chunk, warmed when source setup starts; optional tools remain separate chunks. Report conversation pairing and highest-priority selection use linear passes, and PDF text measurements have a bounded per-render cache.

Document extraction runs locally without an AI request. AI refinement is explicit in the step editor. Remote model latency varies with provider, network, image count, and response size. The annotated benchmark reports median/95th-percentile latency and first-token latency alongside answer quality. Identical cached observations and unusable-view checks avoid another provider call.

Active guidance sessions use opaque per-tab IDs, expire after one hour of inactivity, and are bounded to 100. Live workflow/review state is in memory; restart clears it. Uploaded server copies are removed with session eviction/normal shutdown. Local browser previews start immediately while a server copy uploads for clips. Upload limits: 512 MB video and 2 MB document. Account-owned saved results are separate persistent SQLite snapshots protected by sign-in and ownership checks. Passwords use asynchronous salted scrypt; expiring account tokens are hashed in storage and delivered through HttpOnly/SameSite cookies. The server binds to loopback by default. Account sign-in protects saved training data; anonymous analysis routes remain available. A hosted pilot needs HTTPS, a persistent disk and access control at an appropriate gateway for the whole application/API.

## Verify

```sh
npm run check       # both TypeScript checks and frontend lint
npm test            # backend/domain/API and frontend unit tests
npm run build
npm run test:e2e    # installed Chrome; deterministic fixture backend on port 8102
npm run verify:voice # running app + configured real providers; simulated recognized questions
npm run verify:accounts # running local app on 8101; real storage/PDF, no AI calls
# Optional: exercise development authentication through the running Vite proxy.
npm run verify:accounts -- http://127.0.0.1:8180
```

Browser tests use fake camera/microphone devices and a dedicated deterministic AI fixture. They verify interface behavior and integration contracts, not model accuracy. The account smoke helper accepts local URLs only, creates temporary test accounts/results, exercises media decoding and owned PDF storage, and removes its test account afterward. Real provider smoke checks are recorded separately. See `docs/VALIDATION.md`, `docs/CRITICAL_REVIEW.md` and `docs/APP_ANALYSIS.md` for the feature audit and verification evidence.

## Annotated answer benchmark

Open **http://localhost:8101/evaluation** or use the right-panel Metrics tab. Four generated videos have **85 prepared cases (29 Guardian + 56 Listener)**, including labels, counts, wrong bins, cable connection changes, obstruction/recovery, hidden facts, unrelated documents and provisional discovery. The latest report shows expected/actual replies, current-frame thumbnails, targeted fact/contradiction rules, protocol checks, model comparison and measured latency. Original replies and failed cases are archived.

```sh
npm run evaluate:prepare
npm run evaluate:live
npm run evaluate:live -- --model gpt-4o
```

The two additional test videos and their guidance files are downloadable from the report. See [evaluation/README.md](evaluation/README.md) for reproduction, scoring, optional video re-rendering, and limits. Prepared transcripts test the Listener answer path; physical recognition accuracy is not measured.

## Practical limits

This is process observation and guidance software, not a clinically validated surgical decision system. Sparse video sampling cannot guarantee detection of every action or hazard. Model confidence is not calibrated clinical reliability; repeated evidence can still be wrong. Review extracted/inferred workflows and confirm important decisions with a qualified operator. Surgical deployment needs procedure-specific annotated validation, expert review, and an appropriate clinical evaluation before use in patient care.

## Reproducible release assets

Large videos, audio and archives are kept in the versioned GitHub Release rather than Git history. `deployment/media-manifest.json` records their SHA256, byte size and original paths. `npm run assets:download` restores all runtime media; `node scripts/download-assets.mjs --all` also restores evaluation source videos and video-production assets. The downloader rejects missing or corrupt assets. Original instructions and application code are committed normally. Media retain the attribution and license records supplied with each scenario; release publication does not change those licenses.

The latest recognition evidence is in `evaluation/open-video-scenarios/qa/recognition-update.html`. Exact stage recognition remains 29/32 on original anchors and 30/32 on revised anchors, with the remaining cases abstaining. These results do not establish clinical accuracy.
