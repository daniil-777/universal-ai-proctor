# Industry feature research

Research date: 4 October 2026. Scope: video/camera process guidance for manufacturing, maintenance, inspection, onboarding and training. This is a product-prioritization study, not a certification, clinical validation or an estimate of achieved production savings.

The ranking below is an engineering judgment based on practical operational value, visible user benefit, fit with the existing application, implementation dependencies and risk. Vendor documentation establishes what those products provide; it does not independently establish their effectiveness or prove this application's accuracy. Research benchmarks demonstrate methods on their datasets, not guaranteed transfer to a new factory or a surgical setting.

## Existing capabilities and meaningful gaps

The application already has video and live camera inputs, optional document extraction, editable actions and criteria, provisional visual workflow discovery, Guardian observations, voice questions, operator step confirmation, evidence text, prompts, logs, provider comparisons and report/ZIP exports. Proposing those again would add little value.

The stronger opportunity is to connect those capabilities into an operational loop: find the exact evidence, capture a problem, retain the operator's decision, and communicate unfinished work. The present logs are text-oriented, reports are summaries, and the backend session expires after inactivity. New local features should explain their retention boundaries and avoid implying authenticated approval, immutable storage or industrial certification.

## Ranked opportunities

| Rank | Feature | Short description and visible benefit | Operational value | Dependencies and limits | Suggested sequence |
| --- | --- | --- | --- | --- | --- |
| 1 | Evidence replay | Select an observation to jump to its exact video moment and inspect the associated step, criterion and provenance. Camera entries retain a captured still when available. | Makes a model's judgment inspectable; supervisors and trainees can resolve disagreements quickly. | Preserve source identity, document revision and observation time. A current frame must never be mislabeled as a historical observation. Sources S2, S5, S7. | Implemented; scope below. |
| 2 | Exceptions and handoff | Record a blocker, uncertainty or defect against a step; attach context, add a resolution note and export open work for the next person. | Converts warnings into work that has an owner and an explicit disposition. A concise open-issues brief is useful across maintenance and inspection. | Operator decisions must remain separate from AI statements. A local brief is not a signed CAPA or a substitute for a two-way handover. Sources S1, S6, S7. | Implemented; scope below. |
| 3 | Job readiness | Review extracted tools, current source/document context and operator-added prerequisites before beginning a run. | Prevents avoidable starts with missing materials or the wrong instructions; provides a clear preparation screen. | Only document-derived requirements or explicit operator entries should be presented as requirements. Hidden energy isolation, calibration and authorization require competent people and/or trusted systems. Sources S1, S4, S9. | Implemented first version; scope below. |
| 4 | Answers with exact instruction references | Show the precise document passage, revision and observation moment supporting a guidance answer. | Reduces time spent finding the relevant instruction and exposes unsupported answers. | Requires reliable document spans/retrieval and citation validation; an AI-generated citation alone is not proof. Source S7. | User decision. |
| 5 | Measurements and quality gates | Collect actual measurements with units/tolerances and explicit pass/fail criteria; associate the instrument and calibration record. | Enables real quality decisions for dimensions, torque, pressure or temperature that a camera cannot establish. | Tolerances must come from an approved instruction; units and boundaries need deterministic validation. Tool status needs trusted records. Source S1. | User decision. |
| 6 | Expert-run comparison and coaching | Compare an operator's recording with a reviewed reference run and show moments to improve, with short expert explanations. | Makes onboarding more concrete and preserves practical expert knowledge. | Requires consent, matched task/variant and expert-reviewed labels. Automated skill scores need validation and should not be presented as qualifications. Sources S4, S11. | User decision. |
| 7 | Early sequence-deviation detection | Use an explicit dependency graph and temporal observations to flag a likely skipped prerequisite or out-of-order action early. | The strongest AI demonstration: a useful intervention while the work is still happening. | Process order can vary legitimately. Requires local labeled examples, false-alert/delay metrics and an uncertain state. Visual correctness has task-specific limits. Sources S5, S10. | User decision; research pilot. |
| 8 | Approved instruction versions | Maintain draft/review/published instructions and bind each run to its exact approved version. | Supports controlled changes and explains which procedure an operator actually followed. | Requires user identity, roles, durable storage and approval policy. Local version labels alone are not authenticated signatures or regulated compliance. Sources S2, S3. | User decision. |
| 9 | Read-only machine and job context | Bring actual asset identity, work-order context and trusted machine readings into the guide via adapters. | Gives visual guidance the missing context: correct equipment, actual values and operating state. | Site-specific mappings, credentials, timestamps and data-quality handling. Begin read-only; do not add machine control to a general vision assistant. Source S8. | User decision. |
| 10 | Offline/private edge mode | Cache approved instructions and run supported recognition locally, with explicit cloud/offline status and later synchronization. | Useful where connectivity is poor or footage is sensitive. | Local hardware/model evaluation, reliable conflict handling, storage policy and secure deployment. Guidance quality may differ from cloud models. Sources S7, S8; prioritization is an inference. | User decision; infrastructure work. |
| 11 | Spatial assistance and remote review | Pin guidance to parts in the scene and allow an authorized expert to annotate the operator's view. | Clear visual appeal and useful help when people do not share specialist terminology. | Stable tracking, occlusion/scale handling, video permissions and suitable devices. Avoid dependency on retired platforms. Sources S4, S12. | User decision; hardware pilot. |
| 12 | Team process improvement | Aggregate reviewed run outcomes to find recurring blockers, long steps and instruction confusion by process variant. | Helps improve the procedure rather than repeatedly alerting individual workers. | Durable records, consent/access control, meaningful denominators and separation of process analysis from unvalidated worker ranking. Sources S1, S2, S7; product value is an inference. | User decision. |

## Implementation status

The first three priorities are now implemented in the independent app: Review offers timed evidence, available stills, video replay and frame bookmarks; its exception desk records acknowledgement/resolution/reopening and supplies handoff context; Ready records job context and manual preparation checks suggested from workflow tools and principles. This first readiness implementation does not create arbitrary custom prerequisite definitions or verify hidden conditions. The remaining nine recommendations are left for the user to choose.

Separately requested work adds a polished downloadable PDF, self-contained offline HTML, prepared-file sharing with a download fallback, and persistent email/password training accounts. Saved history holds server-derived snapshots with distinct AI/manual provenance; photographic evidence storage is opt-in. These are additional requested deliverables, not a thirteenth research recommendation. They are implemented locally; online hosting has not been selected or published. Final release test counts are maintained in [VALIDATION.md](VALIDATION.md).

## Source ledger

### S1. Tulip Frontline QMS documentation

[Frontline QMS](https://support.tulip.co/docs/frontline-qms-1). Updated 7 April 2026; accessed 4 October 2026. Primary vendor documentation.

Describes inspection plans, pass/fail and numeric inspections, product/work-order selection, equipment calibration verification, evidence attachments, defects with dispositions and corrective-action records. Relevant to exceptions, preparation and measurements. It supports the existence of these industrial workflows; claims about improved quality or compliance are the vendor's descriptions, not independent outcomes for this application.

### S2. Tulip app completion documentation

[Complete an app](https://support.tulip.co/docs/complete-an-app). Updated 12 March 2026; accessed 4 October 2026. Primary vendor documentation.

Completion records include run duration, operator/station context, app version, execution identity and captured variable values. This supports tying process evidence to a particular run and instruction version. This app should preserve comparable context where available, but must not describe its current transient session or editable browser records as equivalent to a governed immutable record system.

### S3. Tulip instruction/application approvals

[App approvals](https://support.tulip.co/docs/app-approvals). Updated 9 April 2025; accessed 4 October 2026. Primary vendor documentation.

Documents separate development, pending approval and published states, configured approvers and re-authentication for approval. The operator's deployed version changes after the approval process. It demonstrates an enterprise control pattern; it does not mean adding a publish button here meets regulated manufacturing requirements.

### S4. PTC expert capture planning

[Prepare to Capture Procedures](https://www.ptc.com/en/success-paths/get-started-vuforia-expert-capture/setup/prepare-to-capture-procedures). Accessed 4 October 2026. Primary vendor documentation.

PTC describes planning, recording a demonstration, authoring steps and publishing procedures to mobile/tablet/eyewear viewers. Preparation includes an outline, tools/materials and per-step notes; concise action-oriented language is recommended. Relevant to readiness, expert-run coaching and eventually spatial guidance. Productivity statements on the page are vendor claims rather than a controlled study.

### S5. PTC visual inspection limits

[When to Use Step Check](https://support.ptc.com/help/vuforia/editor/en/vuforia_editor/step_check_usage.html). Accessed 4 October 2026. Primary vendor documentation.

Recommends cases where pass and fail are visibly distinguishable and representative physical examples exist. It cautions against movable/flexible components, highly variable visual quality and general anomaly/damage detection requiring large training coverage. This is a useful constraint on future inspection features: presence or position may be visible; hidden connection quality, measured torque or general safety readiness cannot be established from appearance alone.

### S6. HSE shift handover

[Shift handover](https://www.hse.gov.uk/humanfactors/topics/shift-handover.htm). Accessed 4 October 2026. Primary regulator guidance.

HSE emphasizes outgoing preparation, exchange of task-relevant information and incoming cross-checking. It recommends two-way communication supported by written and verbal information and displays designed around operator needs. This supports an open-issues handoff brief while making clear that generating a file does not perform the human handover itself.

### S7. NIST generative AI risk profile

[NIST AI 600-1: Generative Artificial Intelligence Profile](https://nvlpubs.nist.gov/nistpubs/ai/NIST.AI.600-1.pdf). July 2024; accessed 4 October 2026. Primary standards/research agency guidance.

Addresses confidently incorrect content, provenance, human oversight and evaluation in conditions resembling deployment. Actions MS-2.5-001/003 discourage broad claims from narrow tests and call for source verification; MS-4.2-004 concerns recording human overrides; MG-4.3-002 concerns tracking errors and near misses. This supports reviewable evidence, explicit uncertainty and reviewed correction records. It is guidance, not a product certification.

### S8. OPC UA interoperability scope

[OPC Unified Architecture, Part 1: Overview and Concepts](https://reference.opcfoundation.org/specs/OPC-10000-1/4). Accessed 4 October 2026. Primary standards-body specification.

Defines infrastructure for exchanging information across industrial devices, control systems, MES and ERP, including data/information models and communication/conformance models. Relevant to trusted machine and work-order context. The practical recommendation to start with read-only adapters is an engineering choice; integration still requires site-specific mapping and security deployment.

### S9. OSHA hazardous-energy procedure requirements

[29 CFR 1910.147: Control of hazardous energy](https://www.osha.gov/laws-regs/regulations/standardnumber/1910/1910.147). Accessed 4 October 2026. Primary U.S. regulation.

For activities within its scope, the standard addresses specific energy-control procedures, responsibilities and verification of control measures. It demonstrates why a generic readiness screen must not invent a complete lockout procedure or treat an image of a lock as proof of isolation. Applicability depends on the activity and jurisdiction; the proposed app feature is preparation support, not compliance advice.

### S10. PREGO procedural mistake research

[PREGO: online mistake detection in procedural egocentric videos](https://arxiv.org/abs/2404.01933). CVPR 2024; accessed 4 October 2026. Primary research paper.

Combines online action recognition with anticipated next actions to identify deviations, evaluated on adapted Assembly101 and Epic-tent benchmarks. This gives a concrete research direction for early sequence mistakes. Benchmark results do not validate this application's Guardian, other industrial processes or surgery. Research distinguishes causal online processing from strict real-time guarantees; recognition errors and legitimate process variants remain important.

### S11. Ego-Exo4D skilled-activity research

[Ego-Exo4D: Understanding Skilled Human Activity from First- and Third-Person Perspectives](https://arxiv.org/abs/2311.18259). CVPR 2024 paper; accessed 4 October 2026. Primary research paper.

Introduces a substantial multiview dataset and benchmarks for skilled activities, including fine-grained steps and proficiency. It provides a research basis for expert comparison and task-specific coaching, not an established credentialing system. A local app needs its own reviewed demonstrations, appropriate consent and deployment-specific validation before reporting performance scores.

### S12. Microsoft remote assistance and product lifecycle

[Dynamics 365 Remote Assist overview](https://learn.microsoft.com/en-us/dynamics365/mixed-reality/remote-assist/ra-overview). Accessed 4 October 2026. Primary vendor documentation and lifecycle notice.

Documents remote maintenance, inspection, visual annotation and capture of repair knowledge. It states that Guides and Remote Assist cease availability after 31 December 2026 and that the mobile Remote Assist product was deprecated in 2025. Relevant to the value of remote review, but also a warning against building a new dependency around those products. A future integration should use an actively supported, hardware-neutral interface.

## Practical acceptance criteria for the first release

- Evidence replay must retain the correct source and video time, explicitly distinguish video from live camera, and never change current workflow progress merely because a review panel opened.
- Operator exceptions must be editable/resolvable only in their matching run context. Resolution should require an explicit human action and retain the note explaining it. AI concerns should remain identifiable as AI observations.
- Handoff output must include open exceptions, latest known step, input/instruction identity and clear missing-context states. It must not silently include unrelated previous-source records, secrets or fabricated names/measurements.
- Readiness items should come from document-derived tools or explicit operator entries. Missing source/document, pending preparation and unverified items should remain separate states. No document must remain a supported workflow.
- All new UI must remain usable with touch, keyboard and small screens. Storage quota/invalid data, context changes, unavailable media and empty sessions need graceful behavior.
- Initial implementation should avoid new model requests on each render or on every item toggle. These operational features can use existing structured state and deterministic processing, preserving the voice and guidance latency improvements.

## Measuring whether the features matter

Technical checks should cover source isolation, replay accuracy, duplicate/stale event prevention, export correctness and responsive/accessibility behavior. Product pilots should measure time to find disputed evidence, unresolved issues retained during handoff, preparation omissions, false alerts per hour and time to detect a real deviation. Those are stronger measures than a general impression of polish or a model's self-reported confidence. Industrial and clinical effectiveness require separate task-specific evaluation with competent domain reviewers.
