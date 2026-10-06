import { ArrowUpRight } from "lucide-react";
import type { Stage } from "@/lib/types";
import { reportReviewQueue } from "@/lib/reportInsights";

export function ReportReviewQueue({ stages, onReview }: { stages: Stage[]; onReview: (stepId: string) => void }) {
  const queue = reportReviewQueue(stages);
  return <section className="report-review-queue" aria-label="Criterion review queue">
    <div className="report-section-heading"><div><span className="report-kicker">Next review</span><h3>Criteria to follow up</h3></div>
      <span className="report-small-count">{queue.length} {queue.length === 1 ? "step" : "steps"}</span></div>
    <p className="report-caption">Review the recorded status and gather suitable evidence. Unknown criteria are unconfirmed; step confirmation remains a separate record.</p>
    {queue.length ? <ol>{queue.map(({ step, criteria, counts }) => <li key={step.id}>
      <div className="report-queue-heading"><h4>{step.name}</h4><span>{step.complete ? step.confirmation === "manual" ? "Manual confirmation" : step.confirmation === "AI" ? "AI confirmation" : "Confirmed" : "Unfinished"}</span></div>
      <div className="report-queue-counts">{counts.not_met > 0 && <span>{counts.not_met} not met</span>}{counts.partial > 0 && <span>{counts.partial} partial</span>}{counts.unknown > 0 && <span>{counts.unknown} unknown</span>}</div>
      <ul>{criteria.map(criterion => <li key={criterion.key}><span>{criterion.label}</span><b>{criterion.status.replace(/_/g, " ")}</b></li>)}</ul>
      <button type="button" onClick={() => onReview(step.id)} aria-label={`Review step ${step.name}`}>Review this step <ArrowUpRight aria-hidden="true" /></button>
    </li>)}</ol> : <p className="report-empty">No unresolved criteria are recorded. This does not certify that the process was fully observed.</p>}
  </section>;
}
