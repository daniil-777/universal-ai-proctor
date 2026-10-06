# Isolated report QA

Use Node 24 or newer and the checked-in frontend/backend lockfiles. Build the frontend before browser checks. These tests use generated video, synthetic review records, a loopback server and in-memory accounts. Provider keys are cleared before configuration imports; no production URL or real account is used.

From `frontend`:

```sh
npm run build
npx playwright test --config ../scripts/report-qa.playwright.config.ts report-improvements.spec.ts
```

The configuration starts `report-qa-fixture.mts` on `127.0.0.1:8113`. It refuses an occupied port. Its fixture-only seed/snapshot handlers live in an HTTP wrapper, outside the production backend. Ordinary app/API requests use Fastify's native routing. Uploads use an owned temporary directory, deleted on normal shutdown; account data stays in memory.

The 20 browser cases exercise Chrome desktop/320px phone and WebKit tablet/dark phone: snapshot identity, unresolved-step queue, earlier instructions with reused step IDs, missing record/step links, stable evidence references through filters/pagination, known and unknown duration, retained timeline gaps, long identities at 200% text, empty workflows, and saved PDF/HTML snapshots after the live guidance changes. Report interactions assert no workflow/review mutation or provider request. Errors remain unsuppressed. Synthetic account save operations are confined to the fixture.

The same isolated harness supports existing report specs and the editor matrix:

```sh
REPORT_QA_SCREENSHOTS=/tmp/cueveris-report-legacy-captures npx playwright test --config ../scripts/report-qa.playwright.config.ts report-review.spec.ts report-timeline.spec.ts report-guardian-library.spec.ts review-account.spec.ts
REPORT_QA_EDITOR_MATRIX=1 npx playwright test --config ../scripts/report-qa.playwright.config.ts editor-sizing.spec.ts
```

The editor matrix runs 28 Chrome/WebKit cases. Its two WebKit touch-drag cases are explicitly skipped because they use Chromium's CDP input API; the corresponding Chrome cases send actual touch events. Set `EDITOR_QA_SCREENSHOTS` to a temporary directory for optional copies of editor captures.

The legacy Guardian spec writes documentation captures by default. Its `REPORT_QA_SCREENSHOTS` override keeps isolated QA captures outside tracked documentation.

From `backend`, with Poppler's `pdftotext`, `pdfinfo` and `pdftoppm` available:

```sh
node --import tsx ../scripts/report-export-qa.mts
```

`REPORT_QA_OUTPUT` selects an artifact directory. Recheck only affected layouts with repeated `--case=mixed-reference`, `--case=empty`, `--case=unknown-duration` and `--case=adversarial-records` arguments. The complete export suite checks nine unique cases, including 100 steps × 30 criteria, 150 retained records × 24 photos, long unbroken text, invalid legacy/foreign records, supported Unicode and actionable HTML fallback for unsupported PDF glyphs. It extracts actual PDF text, checks destination names and HTML fragment targets, confirms immutable input data, checks timeline pagination, and renders representative pages for human review.

`REPORT_QA_SCREENSHOTS` optionally copies browser captures into a chosen directory. `REPORT_QA_RESULTS` and `REPORT_QA_TEST_OUTPUT` control the browser result locations. Screenshots demonstrate the isolated fixture; they do not establish real AI recognition quality, native operating-system sharing, physical-device behavior or an approved visual-regression baseline.

Existing report/review specs also use `evaluation/assets/parts-sorting.mp4`. Preserve an existing file. If it is absent, a separately authorized bounded synthetic substitute may be generated solely for decoder/UI regression, with its origin recorded and only the owned substitute removed afterward.
