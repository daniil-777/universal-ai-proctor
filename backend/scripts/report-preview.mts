import fs from "node:fs/promises";
import sharp from "sharp";
import { SessionStore } from "../src/domain/session.js";
import { parseDocument } from "../src/domain/guidance.js";
import { appendReviewEvent, structuredHandoff, syncReview } from "../src/domain/review.js";
import { renderAnalysisHtml, renderAnalysisPdf } from "../src/media/analysisReport.js";

const session = new SessionStore().get("report-visual-qa");
session.sourceId = "illustrative-training-source"; session.sourceKind = "video"; session.sourceName = "Precision assembly - training.mp4";
session.videoInfo = { duration: 90, fps: 30, width: 1280, height: 720 }; session.lastTime = 47;
session.filename = "assembly-work-instruction.txt";
session.text = `Precision assembly training review
Safety
Check the work area and keep protective equipment accessible.
Step 1 - Prepare the workspace
Tools: Bench, gloves, assembly kit
Objective: Establish a clear working area before handling components.
Actions: Clear the bench. Lay out components. Check the instruction revision.
Criteria: Working area clear; All components present; Correct instruction selected.
Step 2 - Assemble the housing
Tools: Torque driver, fasteners
Objective: Follow the specified assembly sequence.
Actions: Align the housing. Insert the fasteners. Apply the documented torque.
Criteria: Housing aligned; Fasteners seated; Torque value confirmed by an appropriate measurement.
Step 3 - Inspect and hand over
Actions: Inspect the assembled housing. Record any exception. Prepare the handoff.
Criteria: Inspection recorded; Exceptions reviewed; Handoff received by the next operator.`;
const parsed = parseDocument(session.filename, session.text); session.rows = parsed.rows; session.workflow = parsed.workflow;
session.workflow.title = "Precision assembly / training review";
session.operatorGoals = "Explain the reason for each action. Keep guidance brief and call out missing evidence before suggesting that a step is complete.";
session.workflow.steps[0].complete = true; session.workflow.steps[0].progress = 100; session.workflow.steps[0].confirmation = "manual";
for (const criterion of session.workflow.steps[0].criteria) { criterion.status = "met"; criterion.evidence = "Operator confirmation recorded for this illustrative sample."; criterion.confirmedAt = 12; }
session.workflow.steps[1].progress = 33; session.workflow.steps[1].criteria[0].status = "met"; session.workflow.steps[1].criteria[0].evidence = "AI observation: housing appears aligned in the sampled frame. Torque remains unverified.";
const review = syncReview(session), now = Date.UTC(2026, 9, 4, 14, 20, 0);
review.job = { operator: "Alex Müller", work_order: "TRAINING-204", asset: "Assembly station B" };
for (const check of review.checks.slice(0, 3)) { check.checked = true; check.checked_at = now - 120000; check.checked_by = review.job.operator; }
for (const [index, time] of [12, 28, 47].entries()) {
  const frame = await sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="480" height="260"><rect width="480" height="260" fill="#e5edf0"/><rect x="35" y="65" width="410" height="150" rx="12" fill="#99aab5"/><rect x="${105 + index * 25}" y="105" width="155" height="60" rx="8" fill="#17676b"/><circle cx="350" cy="140" r="25" fill="#e2bc78"/><path d="M30 35h160" stroke="#82939f" stroke-width="10"/><text x="35" y="240" fill="#455b6c" font-size="13">ILLUSTRATIVE QA FRAME / ${time} s</text></svg>`)).jpeg({ quality: 65 }).toBuffer();
  appendReviewEvent(review, { id: `event-${index}`, source_id: session.sourceId, reference_key: review.reference_key, kind: index === 0 ? "milestone" : index === 2 ? "bookmark" : "observation", provenance: index === 2 ? "operator" : "system", occurred_at: now + time * 1000, video_time_s: time, summary: ["Workspace preparation manually confirmed.", "Housing appears aligned; measurement evidence is still missing.", "Operator marked the assembly position for a second review."][index], guidance: "Illustrative training sample. Verify measurements using the approved work instruction.", concern: index === 1 ? "Torque cannot be confirmed from appearance alone." : "", status: index === 1 ? "watch" : "ok", step_ids: index === 0 ? ["S1"] : [], thumbnail_b64: `data:image/jpeg;base64,${frame.toString("base64")}`, operator: index === 2 ? review.job.operator : undefined });
}
review.exceptions = [
  { id: "issue-one", event_id: "event-1", title: "Measurement evidence missing", description: "The sampled video does not establish the applied torque. Check the instrument record before confirming the criterion.", reference_key: review.reference_key, provenance: "operator", status: "acknowledged", created_at: now, updated_at: now + 60000, history: [{ status: "open", note: "Request instrument record from the trainer.", operator: "Alex Müller", at: now }, { status: "acknowledged", note: "Trainer will review the driver log. Criterion remains unverified.", operator: "Alex Müller", at: now + 60000 }] },
  { id: "issue-two", title: "Component label unclear", description: "Operator requested a label check.", reference_key: review.reference_key, provenance: "operator", status: "resolved", created_at: now, updated_at: now + 100000, history: [{ status: "open", note: "Label obscured in the first sampled frame.", operator: "Alex Müller", at: now }, { status: "resolved", note: "Operator checked the physical label against the work instruction. This note does not change workflow completion.", operator: "Alex Müller", at: now + 100000 }] },
];
const data = structuredHandoff(session); data.generated_at = new Date(now + 120000).toISOString();
const destination = new URL("../../output/pdf/", import.meta.url); await fs.mkdir(destination, { recursive: true });
const started = performance.now();
await fs.writeFile(new URL("process-guide-analysis-sample.pdf", destination), await renderAnalysisPdf(data));
await fs.writeFile(new URL("process-guide-analysis-sample.html", destination), renderAnalysisHtml(data));
await fs.writeFile(new URL("process-guide-analysis-sample.json", destination), JSON.stringify(data, null, 2));
console.log(`Illustrative report preview written in ${Math.round(performance.now() - started)} ms.`);
