import type { ReviewResponse } from "@/lib/reviewTypes";
import { reportScope } from "@/lib/reportInsights";

export function ReportScope({ review, identity, sourceName, referenceName }: {
  review: ReviewResponse | null; identity: string; sourceName: string; referenceName: string;
}) {
  const counts = reportScope(review);
  const retention = review?.retention;
  const omitted = !!retention && (retention.dropped_events > 0 || retention.dropped_thumbnails > 0 || retention.dropped_exceptions > 0);
  return <aside className="report-scope" aria-label="Evidence scope and report identity">
    <div className="report-section-heading"><div><span className="report-kicker">Evidence scope</span><h3>What this snapshot contains</h3></div>
      {review && <span className="report-small-count">Review {review.review_version}</span>}</div>
    <p className="report-caption">Retained samples and operator records describe this source. They do not establish continuous coverage or certify the process.</p>
    {review ? <dl className="report-scope-counts">
      {[["Current instructions", counts.current], ["Earlier instructions", counts.earlier], ["Whole-video overview", counts.overview], ["Demo / simulated", counts.simulated]].map(([label, count]) =>
        <div key={label}><dt>{label}</dt><dd>{count}</dd></div>)}
    </dl> : <p className="report-empty">Source review records are unavailable.</p>}
    {omitted && <p className="report-retention-note">Omitted by retention limits: {retention.dropped_events} {retention.dropped_events === 1 ? "record" : "records"}, {retention.dropped_thumbnails} {retention.dropped_thumbnails === 1 ? "photo" : "photos"} and {retention.dropped_exceptions} {retention.dropped_exceptions === 1 ? "issue" : "issues"}. The report includes retained records only.</p>}
    <details className="report-identity"><summary>Full report identity and record details</summary>
      <dl>{[["Report name", identity || "Untitled report"], ["Source", sourceName || "No source name recorded"],
        ["Instructions", referenceName || "No instruction document"], ["Source identifier", review?.source_id], ["Reference digest", review?.reference_key]].filter(([, value]) => value).map(([label, value]) =>
        <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
      {review?.notice && <p className="report-caption">{review.notice}</p>}
      <p className="report-caption">E01… labels are report references within this snapshot. Original record identifiers remain available with each evidence record.</p>
    </details>
  </aside>;
}
