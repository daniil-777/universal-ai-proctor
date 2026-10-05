import { useMemo, useState } from "react";
import { ArrowLeft, ArrowRight, Play, Clock3 } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { ReviewEvent, ReviewResponse } from "@/lib/reviewTypes";
import { formatReportTime, reportMoments, reportProvenance } from "@/lib/reportInsights";

export function ReportTimeline({
  review, onReplay,
}: {
  review: ReviewResponse | null;
  onReplay?: (event: ReviewEvent) => void;
}) {
  const moments = useMemo(() => reportMoments(review), [review]);
  const [selection, setSelection] = useState<{ source: string; id: string }>();
  const index = Math.max(0, moments.findIndex(event =>
    selection?.source === review?.source_id && event.id === selection.id));
  const selected = moments[index];
  const end = moments.at(-1)?.video_time_s ?? 0;
  const groups = useMemo(() => {
    const bins = Array.from({ length: 40 }, () => ({ count: 0, status: "ok" }));
    const rank = { ok: 0, watch: 1, alert: 2 };
    for (const event of moments) {
      const bin = bins[Math.min(39, Math.floor(event.video_time_s / Math.max(1, end) * 40))];
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
      <p className="report-caption">Each mark represents retained evidence. Gaps are unobserved; demo and whole-video overview records are excluded.</p>
      {selected ? (
        <>
          <div className="report-time-lane" role="img" aria-label={`${moments.length} retained moments from ${formatReportTime(moments[0].video_time_s)} to ${formatReportTime(end)}. Gaps do not establish video coverage.`}>
            {groups.map((group, i) => <span key={i} className={`report-time-bin ${group.count ? group.status : "empty"}`} style={{ height: group.count ? `${Math.min(34, 10 + group.count * 4)}px` : "3px" }} />)}
            <i className="report-time-cursor" style={{ left: `${Math.min(100, selected.video_time_s / Math.max(1, end) * 100)}%` }} />
          </div>
          <div className="report-time-axis"><span>00:00</span><span>{formatReportTime(end)} · last retained moment</span></div>
          <div className="report-time-legend"><span><i className="ok" />Recorded</span><span><i className="watch" />Watch</span><span><i className="alert" />Alert</span></div>
          <div className="report-moment-controls">
            <Button variant="outline" size="icon" aria-label="Previous recorded moment" disabled={index === 0} onClick={() => choose(moments[index - 1])}><ArrowLeft className="size-4" /></Button>
            <div className="min-w-0 flex-1"><select aria-label="Choose recorded moment" value={selected.id} onChange={event => { const moment = moments.find(item => item.id === event.target.value); if (moment) choose(moment); }}>
              {moments.map(event => <option key={event.id} value={event.id}>{formatReportTime(event.video_time_s)} · {event.summary || "Evidence record"}</option>)}
            </select></div>
            <Button variant="outline" size="icon" aria-label="Next recorded moment" disabled={index === moments.length - 1} onClick={() => choose(moments[index + 1])}><ArrowRight className="size-4" /></Button>
          </div>
          <div className="report-selected-moment">
            <div className="report-moment-meta"><span><Clock3 className="size-3.5" />{formatReportTime(selected.video_time_s)}</span><span>{reportProvenance(selected)}</span><span className={`report-status ${selected.status}`}>{selected.status}</span>{selected.old_reference && <span>Earlier instructions</span>}</div>
            <p className="report-moment-title">{selected.summary || "Evidence record"}</p>
            {selected.concern && <p className="report-caption">{selected.concern}</p>}
            {onReplay && <Button variant="outline" size="sm" className="mt-3 min-h-11 gap-2" onClick={() => onReplay(selected)}><Play className="size-4" />Review in video</Button>}
          </div>
        </>
      ) : <p className="report-empty">No real moments retained yet. Run guidance or bookmark a frame to start this timeline.</p>}
    </section>
  );
}
