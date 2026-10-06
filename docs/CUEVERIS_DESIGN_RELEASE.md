# Cueveris design release — 6 October 2026

The interface now uses a warm ivory canvas, ink structure, petrol cues and locally bundled Inter typography. Session setup has clear priority, a numbered process rail introduces observe/guide/review, and workspace navigation, evidence labels, controls, dark appearance, accounts and reports share a consistent visual system. The linked video library and favicon follow the same identity. See [DESIGN.md](DESIGN.md) for tokens and component guidance.

The release includes the existing manufacturing demonstration, poster and attribution, plus the watch-only official manufacturing reference. The concurrent film-study workflow remains in its working copy and is outside this design release. Sources were isolated from revision `2328beb` before final checks.

Validation on the isolated source:

- Node 24 production frontend and backend builds passed.
- Backend: 326 tests across 26 files passed, with two workers.
- Frontend: 173 tests across 24 files passed.
- Types and lint passed with zero errors; eight pre-existing Fast Refresh warnings remain in shared component/store modules.
- Final browser regressions: 29 passed, covering intro media and failures, 200% text at 320–1440px, source controls, responsive workspace, mobile WebKit, reference player privacy/focus, video library and report review/export.
- Professional UI QA: 65 states passed across desktop Chrome, 390px and 320px Chrome phones, 820px WebKit tablet, and dark WebKit phone. No page/dialog/report-body overflow, clipped controls, browser errors or external requests. Accounts remained in memory; no real provider calls were made.
- The broader 103-case browser run also exercised voice, camera mocks, recording, workflow evidence, account privacy, exports, touch keyboards and Guardian clips. Its two Chrome shutdown timeouts were addressed by managed Playwright fixtures; all report-review cases passed in the final run without changing assertions or timeout limits.

The manufacturing demo, font license and updated library are explicit release inputs. New media is shipped reproducibly through narrow Git/Docker ignore exceptions. The existing Oracle runtime is updated through the small verified layer described in [UI_STYLE_RELEASE.md](../deployment/oracle/UI_STYLE_RELEASE.md), preserving its runtime dependencies and account volume. Archive and per-file hashes are checked before activation, and an exact prior-image rollback remains available. Activation refuses a concurrent production-image change.
