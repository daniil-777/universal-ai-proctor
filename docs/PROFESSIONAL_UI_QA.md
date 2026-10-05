# Professional UI visual QA

The [recorded verification](professional-ui-validation.json) contains 65 captured states across five browser profiles. The matching images are `docs/screenshots/professional-*.png`. They cover sign-in, registration, an empty account, a saved result and its focused inspection panel, expanded deletion controls, report overview, prepared PDF, workflow evidence, review priorities, explicitly loaded evidence photos, resolved decision history, preparation records and recorded-data Guardian debrief.

The recorded pass checks page, dialog and the report's internal scrolling area separately for horizontal overflow, as well as clipped button contents, browser errors and external requests. Close controls remain visible in every capture; saved-result inspection and report section navigation receive their labelled keyboard focus in every profile. Report photos remain unloaded until the explicit action, which makes exactly one image-inclusive review read per profile. Report interactions make no model, speech or analysis requests. These are visual walkthrough states, counted separately from the unit and browser regression suites.

Four additional timeline regression captures cover desktop, a 320 px phone, a WebKit tablet and a dark WebKit phone. They verify retained-moment selection, zero-time handling, video replay, unchanged confirmations, pinned controls and the internal report-body width. These captures are separate from the 65 walkthrough states. The [current validation record](report-editorial-validation.json) documents all 101 distinct browser scenarios verified across runs.

| Profile | Engine | Viewport | Appearance |
|---|---|---|---|
| Desktop | Installed Chrome | 1440 × 1000 | Light |
| Phone | Installed Chrome | 390 × 844 | Light |
| Small phone | Installed Chrome | 320 × 740 | Light |
| Tablet | Playwright WebKit | 820 × 1180 | Light |
| Phone | Playwright WebKit | 390 × 844 | Dark |

## Run

Use Node 24 or newer with the project's development dependencies installed, FFmpeg/FFprobe available, Chrome installed and Playwright's WebKit browser available. Run `npm run setup` and `npm run build` from the application root first. If WebKit is missing, run `npx playwright install webkit` from `frontend`.

From the application root, check imports, fixture-server startup and both browser engines without capturing the 65 states:

```sh
node --import ./backend/node_modules/tsx/dist/loader.mjs scripts/professional-ui-qa.mts --check-setup
```

Run the complete capture with:

```sh
node --import ./backend/node_modules/tsx/dist/loader.mjs scripts/professional-ui-qa.mts
```

For a focused recheck, append `--profile=phone-dark` (or another profile name above). A focused run writes its JSON into `tmp/pdfs/report-editorial/ui-PROFILE.json`, leaving the full validation record intact. Its profile screenshots are refreshed. This is useful for investigating WebKit-native control sizing and dark scrollbars.

The [helper](../scripts/professional-ui-qa.mts) resolves its inputs relative to its own repository location. A full run requires free local port **8104** and overwrites the verification JSON and 65 screenshots. The setup check uses an ephemeral port and leaves those artifacts unchanged. The helper pauses playback, uses the local parts-sorting video and a two-step `Readiness.txt` fixture, captures a bookmark, leaves one issue open, resolves another with an explicit note, waits for dialog opening transitions, and dismisses the fixture's stale document-extraction toast through its close control. Before the report pass it reloads the React store to remove photos previously fetched by the Review workbench; the report gallery then loads photos explicitly and filters to the bookmark record.

## Isolation and scope

The helper starts its own backend with `fixtureComplete` and `AccountStore({ file: ":memory:" })`. Accounts, passwords and saved results belong only to this temporary store; production accounts and ports 8101/8102 are not used. All AI completion requests use deterministic local fixture responses, so the recorded provider-call count is zero. The debrief endpoint also runs locally. Each profile uses a fresh browser context, and the helper closes its browsers, server and memory database when it finishes. No messages are sent externally.

Fixture response contents are deterministic; retained observation counts may vary with browser timing. The gallery selects Bookmarks before checking the single captured frame so startup fixture observations cannot invalidate the photo-count assertion. PDF preparation is exercised, while native device sharing and the irreversible account-deletion action are not performed. Phone and tablet profiles emulate viewport and touch behavior; they do not validate physical cameras, microphones, on-screen keyboards, operating-system share sheets or real-device performance. Overflow and button measurements supplement manual screenshot inspection; they do not establish process-detection accuracy, certified proficiency or clinical suitability.

The [report browser regressions](../frontend/tests/report-review.spec.ts) separately exercise the real fixture API on desktop Chrome, a 320 px Chrome phone and an 820 px WebKit tablet. They assert priority links and section focus, explicit photo loading, resolved exception history, safe offline HTML content, unchanged workflow state and no model requests during report use. A fourth case prepares a PDF, records a new decision, confirms the earlier snapshot version is disclosed, and explicitly refreshes it before downloading a valid PDF. These tests use temporary server port **8102**, independent of the visual helper and the running app.

The [Guardian library and original surgical sample regressions](../frontend/tests/report-guardian-library.spec.ts) add four WebKit workflows on desktop, a 320 px phone and an 820 px tablet. They load the preserved 252.766667-second original sample with its byte-identical surgical TXT, decode and seek actual video, verify all six extracted steps, route explicit Guardian analysis and streaming Q&A through the surgical reference, record manual confirmation, and capture an actual surgical frame in the report. WebKit's media duration includes a final presentation frame, so browser duration assertions allow less than 0.05 seconds difference; file and API tests check the original duration separately.

The library tests retain both a watch and an alert from the local fixture provider, including a finding recorded against earlier instructions. Opening the report loads its deferred module but does not request clips. Explicit preparation verifies the source/reference query guards, focuses a single paused native video, decodes and downloads a real nine-second MP4, and exercises file sharing through a browser-local stub. Closing pauses and detaches the video and revokes its blob URL. A tablet case holds a valid prior-source MP4 response, closes the report, replaces the source with the surgical sample, and verifies that the delayed response cannot restore a preview or old findings. The [recorded targeted browser pass](report-browser-validation.json) contains the measured runs and five additional screenshots.

These deterministic-provider checks validate workflow extraction, data grounding, source ownership, media handling and UI behavior. Their canned answers do not measure surgical recognition or medical accuracy, and no sharing request reaches an external application. The original simulator telemetry tripwire and specialized phase-detector algorithms are not activated in the general app; clinical equivalence cannot be inferred from unchanged video and document bytes.

The earlier [browser acceptance record](report-browser-validation.json) verifies all **93 distinct browser cases** across a complete run with **92 passes** (3.9 minutes) and a final affected recheck with **22 passes** (1.2 minutes). An additional related UI pass verified 40 cases before the last dropdown text correction. These are distinct-case coverage figures across runs; they do not describe an entirely green single 93-case run. The failures led to fixes for the enlarged intro header, the Guidance goals button and the surgical sample dropdown. Earlier request-frame assertions were also updated to inspect real browser-canvas JPEGs because the new server-owned video path intentionally samples its full window on the backend.

The final 320 px intro check waits for its lazy content and fonts, doubles the text size, verifies the full title and visible 44 px theme control, opens the original surgical sample menu, checks its complete title and metadata against both viewport and internal clipping, and checks page overflow again after closing it. The matching captures are [header](screenshots/intro-small-phone-200-header.png), [full page](screenshots/intro-small-phone-200-text.png) and [surgical source menu](screenshots/intro-small-phone-200-source-menu.png). The surgical regression also verifies that a check immediately after seeking to 30 seconds sends no browser frames, receives nine actual server frames with increasing timestamps within the trailing eight seconds, and uses the current surgical source in streaming Q&A.
