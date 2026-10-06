# Cueveris interface design

Cueveris is a working instrument for people observing a process, following guidance, and reviewing recorded evidence. Its visual direction is a precision workshop: warm paper, ink structure, petrol cues, upright typography, thin rules, and clearly numbered steps. Video and evidence remain the main content.

## Audit and corrections — 6 October 2026

| Area | Inconsistency found | Applied direction |
| --- | --- | --- |
| Color | VirtaMed light, Catppuccin dark, green tour controls, separate account/report colors | One Cueveris token palette, shared ink surfaces and semantic status colors |
| Typography | Inter declared but never loaded; duplicate body declarations | Locally bundled Inter variable with optical sizing, one Tailwind sans stack, SIL OFL license |
| Hierarchy | Library card stronger than the session action | Session setup first; library as a quieter secondary link |
| Process identity | Generic undifferentiated surfaces | Three-part numbered cue rail; matching process-step numerals |
| Components | Competing 6/8/12/16px corner treatments and pill controls | 6px controls and 10px surfaces, intentional circular indicators only |
| Density | Critical evidence and timestamps at 9–11px | 12px provenance, 13–14px reading copy, compact workspace navigation |
| Dark appearance | Pale stage badges with white text | Paired semantic foreground tokens; petrol accent in either appearance |
| Reports/accounts | Independent gradients and colors | Shared ink panels, restrained semantic charts, readable metadata |
| Brand copy | Cueveris chrome with Process Guide labels | Cueveris user-visible product labels; existing technical keys remain stable |
| Media | New local demo absent in production; credits URL missing | Ship demo, poster and attribution together; request playback explicitly |

## Palette

`frontend/src/index.css` is the source of truth. Components use semantic tokens rather than ad hoc hex colors. The ink header is consistent across appearances; portaled controls inherit the page appearance.

| Role | Light HSL | Dark HSL |
| --- | --- | --- |
| Canvas | 42 30% 96% | 205 30% 10% |
| Surface | 40 33% 99% | 205 28% 13% |
| Text | 205 36% 14% | 42 25% 94% |
| Secondary text | 202 12% 39% | 194 13% 70% |
| Primary cue | 184 65% 27% | 177 43% 64% |
| Success | 154 52% 29% | 154 43% 66% |
| Concern | 34 83% 32% | 36 70% 65% |
| Alert | 9 62% 40% | 9 72% 72% |

Status requires a label or icon alongside color. A provisional stage, an active stage and a confirmed stage must remain distinct. Model confidence never implies confirmed progress.

## Letters, spacing and controls

Use Inter with system fallback. Normal copy is 400–500, controls 500–600, headings 550–620. Hero headings use tight tracking and compact leading; paragraphs use 1.6–1.8 leading. Preserve tabular numerals for time, process numbers and measured progress. Use uppercase tracking only for short secondary labels. Latin, extended Latin and Cyrillic font subsets are local assets, loaded only for their character ranges; other scripts retain system fallback.

Use a 4px spacing rhythm. Intro sections have generous separation; tools remain compact enough for repeat use. Controls use a 6px radius; grouping surfaces and dialogs use 10px. Elevation is reserved for floating guidance and dialogs. Avoid decorative gradients, extra nested cards and visual effects over video.

Native buttons, labelled inputs and Radix dialog/menu semantics remain intact. Show a visible 2px focus ring, preserve keyboard focus restoration, and keep touch controls at least 44px. Selected tabs have a clear color and underline treatment. Disabled actions must remain distinguishable. All animation honors reduced motion.

## Responsive behavior

The entry page uses two editorial columns on desktop and a single column on phones. The cue rail becomes compact, the source cards stack, and session actions stay reachable. The workspace preserves the same mounted video while adapting: desktop side panels, a source drawer on tablets, and a stacked video/guidance view on phones. Reports and account dialogs scroll internally and follow the visible viewport, including software keyboards and safe areas.

## Verification

Use the production build for visual review. Run existing unit/type/lint checks and browser regressions for intro, walkthrough, mobile sources, guidance, reports and accounts. `scripts/professional-ui-qa.mts` exercises desktop, 320px/390px phones, tablet WebKit and dark phone WebKit against a deterministic fixture with in-memory accounts. Check horizontal overflow, complete labels, focus, touch controls and error states. AI provider requests are unnecessary for visual QA. Release evidence and public verification are recorded separately.
