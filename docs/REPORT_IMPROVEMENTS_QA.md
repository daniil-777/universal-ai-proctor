# Report review validation — 6 October 2026

The report now separates current instructions, earlier instructions, whole-video overviews and simulated records; shows unresolved criteria in a review queue; and links issues to stable, snapshot-local evidence references. Known video duration determines the timeline extent. Missing retained records and out-of-range moments remain explicit. PDF and offline HTML preserve the saved snapshot.

## Validation

| Check | Result |
| --- | --- |
| Backend unit suite | 347 passed |
| Frontend unit suite | 220 passed |
| New report browser cases | 20 passed across desktop Chrome, 320px Chrome phone, WebKit tablet and dark WebKit phone |
| Existing report, timeline, Guardian and account cases | 16 passed; affected report cases rechecked after layout fixes |
| Editor regression matrix | 26 passed; 2 WebKit cases explicitly skipped because touch injection uses Chromium CDP |
| Deployment/media packaging checks | 12 passed |
| Independent PDF/offline HTML exports | 9 cases passed; 4 affected timeline layouts rechecked after pagination fixes |
| Type/lint/build | Passed; 8 existing Fast Refresh warnings in frontend primitives/store |

The largest workflow export contained 100 steps × 30 criteria and produced a 540-page PDF. Actual PDF text extraction verified the final criterion and long unbroken suffix. Another case preserved 150 retained records and 24 photos in a 78-page PDF. Checks covered supported Unicode, actionable offline HTML fallback for unsupported PDF glyphs, valid fragment/destination links, timeline pagination, and unchanged input snapshots.

Browser checks used ordinary clicks and keyboard navigation, including Close and report section navigation. They checked large text, long identifiers, empty/legacy workflows, filters, pagination, reused step IDs, missing links, source duration, and saved reports after live guidance changes. Page errors remained unsuppressed; report reads caused no monitored provider calls or workflow/review writes.

The public [synthetic report preview](https://daniil-777.github.io/universal-ai-proctor/media/cueveris-report-preview.html) contains invented demonstration data and states that no real manufacturing process was assessed. It is static HTML without active scripts, external assets, accounts or backend access. Its layout and ordinary issue → evidence → workflow navigation were checked at desktop, tablet and 320px phone widths.

## Rendered artifacts

These are distinct captures of the isolated synthetic fixture, inspected for layout and clipping. They do not replace an approved visual baseline.

- [Desktop overview](captures/report-improvements-desktop-overview.png)
- [Tablet evidence timeline](captures/report-improvements-tablet-timeline.png)
- [Phone overview](captures/report-improvements-phone-overview.png)

## Reproduction and limits

See [isolated report QA instructions](../scripts/REPORT_QA.md). The harness clears provider keys, binds to loopback, uses in-memory test accounts and owns its temporary uploads. Fixture routes are outside the production application and are excluded from the deployment payload. The existing hash-verified parts-sorting runtime fixture was preserved unchanged.

These checks establish report integrity and UI/export behavior with synthetic records. They do not establish recognition accuracy, continuous observation, manufacturing certification, native operating-system sharing or physical-device behavior. No user-approved pixel baseline was available. Real production accounts and paid providers were not exercised.

The Oracle deployment package preserves checksum verification, the expected-current-image guard and rollback. Public preview deployment and full server activation are separate: full activation requires working SSH authentication to the existing Oracle server.
