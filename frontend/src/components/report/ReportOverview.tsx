import { ArrowUpRight } from "lucide-react";
import { useMemo } from "react";
import type { Stage } from "@/lib/types";
import type { ReviewResponse } from "@/lib/reviewTypes";
import { reportCounts } from "@/lib/reportInsights";

export type ReportSection = "overview" | "timeline" | "guardian" | "export" |
  "workflow" | "evidence" | "issues" | "preparation" | "debrief" | "conversation";

export function ReportOverview({ stages, review, onNavigate }: {
  stages: Stage[];
  review: ReviewResponse | null;
  onNavigate: (section: ReportSection) => void;
}) {
  const counts = useMemo(() => reportCounts(stages, review), [stages, review]);
  const unresolved = useMemo(() => {
    const rank = { not_met: 0, partial: 1, unknown: 2, met: 3 };
    let count = 0;
    let first: { label: string; status: keyof typeof rank; stepName: string } | undefined;
    for (const step of stages) for (const criterion of step.criteria) {
      if (criterion.status === "met") continue;
      count++;
      if (!first || rank[criterion.status] < rank[first.status])
        first = { label: criterion.label, status: criterion.status, stepName: step.name };
    }
    return { count, first };
  }, [stages]);
  const issues = review?.exceptions.filter(issue => issue.status !== "resolved") ?? [];
  const unchecked = review?.checks.filter(check => !check.checked) ?? [];
  const priorities: { section: ReportSection; label: string; count: number; title: string; detail: string }[] = [
    ...(issues.length ? [{ section: "issues" as const, label: "Open issues", count: issues.length,
      title: issues[0].title, detail: "Review the recorded concern and decision history." }] : []),
    ...(unresolved.first ? [{ section: "workflow" as const, label: "Criteria need review", count: unresolved.count,
      title: unresolved.first.label, detail: `${unresolved.first.stepName} · ${unresolved.first.status.replace(/_/g, " ")}` }] : []),
    ...(unchecked.length ? [{ section: "preparation" as const, label: "Preparation remaining", count: unchecked.length,
      title: unchecked[0].label, detail: "Operator confirmation is still outstanding." }] : []),
  ];
  const groups = [
    { label: "Met", count: counts.criteria.met, color: "hsl(var(--primary))" },
    { label: "Partial", count: counts.criteria.partial, color: "hsl(var(--warning))" },
    { label: "Not met", count: counts.criteria.not_met, color: "hsl(var(--destructive))" },
    { label: "Unknown", count: counts.criteria.unknown, color: "hsl(var(--muted-foreground) / .3)" },
  ];
  const origins = [
    { label: "AI observation", count: counts.evidence.ai, color: "hsl(var(--primary))" },
    { label: "Operator record", count: counts.evidence.operator, color: "hsl(var(--muted-foreground))" },
    { label: "System check", count: counts.evidence.system, color: "hsl(var(--muted-foreground) / .3)" },
    { label: "Demo / simulated", count: counts.evidence.simulated, color: "hsl(var(--warning))" },
  ];
  const distribution = (title: string, items: typeof groups, total: number, note: string, label?: string) => (
    <div>
      <h4 className="report-insight-title">{title}<span>{total} recorded</span></h4>
      <div className="report-distribution" role="img" aria-label={`${label || title}: ${items.map(item => `${item.label}: ${item.count}`).join(", ")}`}>
        {items.filter(item => item.count).map(item => <span key={item.label} style={{ width: `${item.count / total * 100}%`, background: item.color }} />)}
      </div>
      <ul className="report-legend">{items.map(item => <li key={item.label}><i style={{ background: item.color }} aria-hidden="true" />{item.label}<b>{item.count}</b></li>)}</ul>
      <p className="report-caption">{note}</p>
    </div>
  );
  const circumference = 2 * Math.PI * 50;
  const confirmed = counts.completed / Math.max(1, stages.length);
  return (
    <section className="report-overview" aria-label="Review priorities" data-report-section="overview" tabIndex={-1}>
      <div className="report-summary">
        <div>
          <span className="report-kicker">01 / Review at a glance</span>
          <h3>{!stages.length ? "No workflow recorded." : priorities.length ? "Review required." : counts.confirmation.unfinished ? "Review in progress." : "Recorded steps confirmed."}</h3>
          <p>{stages.length ? `${counts.completed} of ${stages.length} steps are confirmed at this snapshot. ${unresolved.count} ${unresolved.count === 1 ? "criterion still needs" : "criteria still need"} review.` : "No workflow has been extracted yet. Load instructions or guide the source to begin."} Completion reflects recorded confirmations, not an assessment of the entire process.</p>
          <div className="report-summary-labels"><span>{counts.confirmation.ai} AI</span><span>{counts.confirmation.manual} manual</span>{counts.confirmation.other > 0 && <span>{counts.confirmation.other} other confirmation</span>}<span>{counts.confirmation.unfinished} unfinished</span></div>
        </div>
        <div className="report-ring" role="img" aria-label={stages.length ? `${counts.completed} of ${stages.length} steps confirmed: ${counts.confirmation.ai} AI, ${counts.confirmation.manual} manual, ${counts.confirmation.other} other, ${counts.confirmation.unfinished} unfinished` : "No workflow steps yet"}>
          <svg viewBox="0 0 120 120" aria-hidden="true"><circle className="report-ring-track" cx="60" cy="60" r="50" fill="none" strokeWidth="6" /><circle className="report-ring-progress" cx="60" cy="60" r="50" fill="none" strokeWidth="6" strokeDasharray={`${confirmed * circumference} ${circumference}`} /></svg>
          <div className="report-ring-copy"><strong>{stages.length ? `${counts.completed}/${stages.length}` : "—"}</strong><span>{stages.length ? "steps confirmed" : "no steps yet"}</span></div>
        </div>
      </div>
      <dl className="report-metrics" aria-label="Report overview">
        <div><dt>Open issues</dt><dd>{review ? issues.length : "—"}</dd><p>{review ? "Awaiting reviewer decision" : "Review unavailable"}</p></div>
        <div><dt>Evidence records</dt><dd>{review ? counts.evidenceTotal : "—"}</dd><p>Retained for this source</p></div>
        <div><dt>Preparation checks</dt><dd>{review?.checks.length ? `${review.checks.length - unchecked.length}/${review.checks.length}` : "—"}</dd><p>Operator records</p></div>
      </dl>
      <div className="report-insights">
        {distribution("Criterion status", groups, counts.criteriaTotal, "Recorded status includes manual and AI confirmations; it is not an accuracy or quality score.", "Criterion status counts")}
        {distribution("Where evidence comes from", origins, counts.evidenceTotal, "Counts describe retained records. They do not establish continuous video coverage.")}
      </div>
      <div className="report-priorities">
        <div className="report-section-heading"><div><span className="report-kicker">Follow-through</span><h3>Review priorities</h3></div><span className="report-small-count">{priorities.length} categories</span></div>
        {priorities.length ? <ul>{priorities.map((item, index) => <li key={item.section}>
          <button type="button" onClick={() => onNavigate(item.section)} aria-label={`Review ${item.label.toLowerCase()}`}>
            <span className="report-priority-number">{String(index + 1).padStart(2, "0")}</span>
            <div className="min-w-0 flex-1"><p className="report-priority-label">{item.label}<b>{item.count}</b></p><p className="report-priority-title">{item.title}</p><p className="report-caption">{item.detail}</p></div><ArrowUpRight className="mt-1 size-4 shrink-0 text-primary" />
          </button>
        </li>)}</ul> : <p className="report-empty">{!review ? "Load a source and its review records to identify follow-up work." : !stages.length || !counts.criteriaTotal ? "Workflow criteria are not available. Guide the source or load instructions to begin a recorded review." : "No outstanding items in the recorded review. This does not establish that the entire process was observed."}</p>}
        {priorities.length > 0 && <p className="report-caption mt-3">First item per category. Every retained record remains in the sections below.</p>}
      </div>
    </section>
  );
}
