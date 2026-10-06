import { useMemo, useState } from "react";
import { ArrowLeft, ArrowRight, Play, Clock3 } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { ReviewEvent, ReviewResponse } from "@/lib/reviewTypes";
import { currentReportReference, formatReportTime, reportTimelineData, reportProvenance, reportReferences } from "@/lib/reportInsights";

export function ReportTimeline({
  review, onReplay, onEvidence,
}: {
  review: ReviewResponse | null;
  onReplay?: (event: ReviewEvent) => void;
  onEvidence?: (eventId: string) => void;
}) {
  const { moments, end, durationKnown, outOfRangeCount, invalidTimestampCount } = useMemo(() => reportTimelineData(review), [review]);
  const references = useMemo(() => reportReferences(review), [review]);
  const [selection, setSelection] = useState<{ source: string; id: string }>();
  const index = Math.max(0, moments.findIndex(event =>
    selection?.source === review?.source_id && event.id === selection.id));
  const selected = moments[index];
  const groups = useMemo(() => {
    const bins = Array.from({ length: 40 }, () => ({ count: 0, status: "ok" }));
    const rank = { ok: 0, watch: 1, alert: 2 };
    for (const event of moments) {
      const bin = bins[Math.min(39, Math.floor(event.video_time_s / (end > 0 ? end : 1) * 40))];
      bin.count++;
      if (rank[event.status] > rank[bin.status as keyof typeof rank]) bin.status = event.status;
    }
    return bins;
  }, [moments, end]);
  const choose = (event: ReviewEvent) => setSelection({ source: event.source_id, id: event.id });
  return (
    <section className="report-timeline" aria-label="Recorded timeline" data-report-section="timeline" tabIndex={-1}>
      <div className="report-section-heading">
        <div><span className="report-kicker">02 / Recorded moments</span><h3>Evidence in time</h3></div>
        <span className="report-small-count">{moments.length} {moments.length === 1 ? "moment" : "moments"}</span>
      </div>
      <p className="report-caption">Each mark represents retained evidence. Gaps have no retained record; they do not establish observation coverage. Demo and whole-video overview records are excluded.</p>
      {outOfRangeCount > 0 && <p className="report-retention-note">{outOfRangeCount} {outOfRangeCount === 1 ? "record falls" : "records fall"} outside the known source duration and {outOfRangeCount === 1 ? "is" : "are"} excluded from this timeline. Full records remain in Evidence.</p>}
      {invalidTimestampCount > 0 && <p className="report-retention-note">{invalidTimestampCount} {invalidTimestampCount === 1 ? "record has" : "records have"} no valid source timestamp and {invalidTimestampCount === 1 ? "is" : "are"} excluded from this timeline. Full records remain in Evidence.</p>}
      {(selected || durationKnown) && (
        <>
          <div className="report-time-lane" role="img" aria-label={`${moments.length} retained moments across ${durationKnown ? "known source duration" : "retained timestamp extent"} 00:00 to ${formatReportTime(end)}. Gaps have no retained record and do not establish video coverage.`}>
            {groups.map((group, i) => <span key={i} className={`report-time-bin ${group.count ? group.status : "empty"}`} style={{ height: group.count ? `${Math.min(34, 10 + group.count * 4)}px` : "3px" }} />)}
            {selected && <i className="report-time-cursor" style={{ left: `${Math.min(100, selected.video_time_s / (end > 0 ? end : 1) * 100)}%` }} />}
          </div>
          <div className="report-time-axis"><span>00:00</span><span>{formatReportTime(end)} · {durationKnown ? "source duration" : "last retained moment"}</span></div>
          <p className="report-caption">{durationKnown ? `${moments.length ? `Last retained moment: ${formatReportTime(moments.at(-1)!.video_time_s)}. ` : ""}Source duration does not establish continuous observation.` : "Source duration is unavailable. The timeline ends at the last retained timestamp."}</p>
          <div className="report-time-legend"><span><i className="ok" />Recorded</span><span><i className="watch" />Watch</span><span><i className="alert" />Alert</span></div>
        </>
      )}
      {selected ? (
        <>
          <div className="report-moment-controls">
            <Button variant="outline" size="icon" aria-label="Previous recorded moment" disabled={index === 0} onClick={() => choose(moments[index - 1])}><ArrowLeft className="size-4" /></Button>
            <div className="min-w-0 flex-1"><select aria-label="Choose recorded moment" value={selected.id} onChange={event => { const moment = moments.find(item => item.id === event.target.value); if (moment) choose(moment); }}>
              {moments.map(event => <option key={event.id} value={event.id}>{references.get(event.id)?.label} · {formatReportTime(event.video_time_s)} · {event.summary || "Evidence record"}</option>)}
            </select></div>
            <Button variant="outline" size="icon" aria-label="Next recorded moment" disabled={index === moments.length - 1} onClick={() => choose(moments[index + 1])}><ArrowRight className="size-4" /></Button>
          </div>
          <div className="report-selected-moment">
            <div className="report-moment-meta"><b className="report-reference-label">{references.get(selected.id)?.label}</b><span><Clock3 className="size-3.5" />{formatReportTime(selected.video_time_s)}</span><span>{reportProvenance(selected)}</span><span className={`report-status ${selected.status}`}>{selected.status}</span>{review && !currentReportReference(selected, review) && <span>Earlier instructions</span>}</div>
            <p className="report-moment-title">{selected.summary || "Evidence record"}</p>
            {selected.concern && <p className="report-caption">{selected.concern}</p>}
            {onReplay && <Button variant="outline" size="sm" className="mt-3 min-h-11 gap-2" onClick={() => onReplay(selected)}><Play className="size-4" />Review in video</Button>}
            {onEvidence && <Button variant="outline" size="sm" className="mt-3 min-h-11" onClick={() => onEvidence(selected.id)}>View evidence {references.get(selected.id)?.label}</Button>}
          </div>
        </>
      ) : <p className="report-empty">No real moments retained yet{durationKnown ? " within the known source duration" : ""}. Run guidance or bookmark a frame to start this timeline.</p>}
    </section>
  );
}
