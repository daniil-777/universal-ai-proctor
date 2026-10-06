import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { ArrowUpRight, FileJson, Loader2, Play, Sparkles } from "lucide-react";
import { useApp } from "@/lib/store";
import { domainLabel, DOMAIN_OPTIONS, recapEvidence, recapHasResult, recapIsActive, recapTime, type VideoSummaryJob } from "@/lib/videoSummaryTypes";
import { getSpeechPhase, subscribeSpeech } from "@/lib/speech";
import { Button } from "./ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "./ui/dialog";
import { ReportLauncher } from "./ReportLauncher";
import "./video-recap.css";

const statusLabel: Record<VideoSummaryJob["status"], string> = { queued: "Waiting to analyze", planning: "Understanding the process", analyzing: "Analyzing video windows", synthesizing: "Writing the final recap", complete: "Analysis complete", partial: "Partial result", cancelled: "Analysis canceled", failed: "Analysis failed", stale: "Inputs changed" };

export function VideoRecapProgress({ job }: { job: VideoSummaryJob }) {
  const processed = job.progress.completed_windows + job.progress.failed_windows;
  return <div className="recap-progress" role="status" aria-live="polite">
    <div><strong>{statusLabel[job.status]}</strong><span>{processed} / {job.progress.total_windows} windows processed</span></div>
    <progress data-testid="video-recap-progress" aria-label="Video recap processing" max={Math.max(1, job.progress.total_windows)} value={job.progress.total_windows ? processed : undefined} />
    <p>{job.progress.completed_windows} successful · {job.progress.failed_windows} failed · {job.progress.sampled_frames} sampled frames</p>
    <p>Latest processed time {recapTime(job.progress.analyzed_through_s)} / {recapTime(job.source.duration_s)}. Sampled windows do not establish continuous visual coverage.</p>
    <p>Analysis model: {job.model.model_id}. This job keeps its original model.</p>
  </div>;
}

export function VideoRecapPanel() {
  const a = useApp(); const recap = a.recap;
  if (!recap) return null;
  return <section className="recap-panel" aria-label="Video recap controls">
    <span className="recap-eyebrow">A clearer view of the whole video</span>
    <h3>Understand what happened.</h3>
    <p>Domain-aware chapters, supported metrics and a playback narrator. Workflow confirmations stay separate.</p>
    {!recap.eligible && <p className="recap-notice">{a.useMock ? "Turn off Demo mode to create a real video recap." : "Upload a video to a connected backend. Camera and screen guidance remain available in Steps."}</p>}
    {recap.job && <VideoRecapProgress job={recap.job} />}
    {recap.awaitingSummary && <p className="recap-notice">Playback ended. The recap will open when analysis finishes.</p>}
    <Button variant="outline" className="recap-action" aria-label="Open video recap from guidance" onClick={recap.openRecap}><Sparkles aria-hidden="true" />{recapHasResult(recap.job) ? "View video recap" : "Create video recap"}</Button>
    <label className="recap-check"><input type="checkbox" checked={recap.narrationEnabled} disabled={!recap.job || !recap.eligible} onChange={event => recap.setNarrationEnabled(event.target.checked)} />Narrate during playback</label>
    <p className="recap-small">Narration follows completed sampled windows at playback time and yields to your questions.</p>
    {recap.ownsUploadedAnalysis && <p className="recap-small">Automatic uploaded-video guidance stays paused for this recap. Resume it when analysis finishes, or change the source or instructions.</p>}
    {recap.ownsUploadedAnalysis && recap.job && !recapIsActive(recap.job) && <Button className="recap-action" variant="outline" disabled={!!recap.actionBusy} onClick={recap.resumeGuidance}>Resume guidance</Button>}
    {recap.guidanceResumed && <p className="recap-small">Guidance is available again. The saved recap remains available for these inputs.</p>}
  </section>;
}

export function VideoRecapDialog() {
  const a = useApp(); const recap = a.recap;
  const [evidenceIds, setEvidenceIds] = useState<string[]>([]);
  const evidence = useRef<HTMLDivElement>(null);
  const speechPhase = useSyncExternalStore(subscribeSpeech, getSpeechPhase, getSpeechPhase);
  useEffect(() => { setEvidenceIds([]); }, [recap?.job?.id, a.sourceId]);
  useEffect(() => { if (evidenceIds.length) { evidence.current?.scrollIntoView({ block: "nearest", behavior: "instant" }); evidence.current?.focus({ preventScroll: true }); } }, [evidenceIds]);
  if (!recap) return null;
  const job = recap.job; const result = recapHasResult(job);
  const domainMetricIds = new Set(job?.metric_plan.map(metric => metric.id));
  const orderedMetrics = [...(job?.metrics ?? [])].sort((left, right) => Number(domainMetricIds.has(right.id)) - Number(domainMetricIds.has(left.id)));
  const controlsDisabled = recap.active || !!recap.actionBusy;
  const seek = (time: number) => {
    if (!job || job.source.id !== a.sourceId) return;
    window.dispatchEvent(new CustomEvent("guidance-review-seek", { detail: { sourceId: job.source.id, timeS: time } }));
    recap.setOpen(false);
  };
  const citations = (ids: string[]) => <div className="recap-citations">{ids.map(id => <button key={id} type="button" aria-label={`View evidence ${id}`} onClick={() => setEvidenceIds([id])}>{id}<ArrowUpRight aria-hidden="true" /></button>)}</div>;
  const options = <section className="recap-options" aria-label="Video recap settings">
    <div className="recap-section-head"><div><span className="recap-eyebrow">Choose the next analysis</span><h3>Make it relevant to your work.</h3></div></div>
    <div className="recap-option-grid">
      <label>Analysis detail<select value={recap.mode} disabled={controlsDisabled} onChange={event => recap.setMode(event.target.value as "detailed" | "balanced")}><option value="detailed">Detailed · 6-second windows</option><option value="balanced">Balanced · 12-second windows</option></select></label>
      <label>Process domain<select value={recap.domainOverride} disabled={controlsDisabled} onChange={event => recap.setDomainOverride(event.target.value as typeof recap.domainOverride)}><option value="auto">Infer from video and instructions</option>{DOMAIN_OPTIONS.map(domain => <option key={domain} value={domain}>{domainLabel(domain)}</option>)}</select></label>
    </div>
    <p className="recap-small">{recap.mode === "detailed" ? "Detailed cross-checks observations against the same sampled images before accepting each window. This can improve consistency; it does not guarantee accuracy." : "Balanced uses one observation pass per window for fewer model calls. Review sampled evidence where details matter."}</p>
    <label className="recap-check"><input type="checkbox" checked={recap.includeAudio} disabled={controlsDisabled || !recap.plan?.audio_available} onChange={event => recap.setIncludeAudio(event.target.checked)} />Include video audio</label>
    <p className="recap-small">{recap.plan?.audio_available ? "Optional transcription uses the video's actual speech and timestamps. No speaker identity is inferred from appearance." : "Audio is not available for this source or connection. Visual analysis can continue."}</p>
    {recap.planLoading ? <p role="status" className="recap-small">Preparing the plan…</p> : recap.plan && <p className="recap-plan">{recap.plan.total_windows} windows · up to {recap.plan.frames_per_window} frames per window · {recap.plan.estimated_model_calls} estimated model calls. Actual calls may vary with audio and retries.</p>}
    <p className="recap-small">Settings apply to the next analysis. A recap does not confirm workflow steps or measure overall quality or safety.</p>
    <p className="recap-small">Using {a.model.display}.</p>
    <Button className="recap-action" disabled={!recap.eligible || !recap.plan || controlsDisabled || recap.planLoading} onClick={() => void recap.start()}>{recap.actionBusy === "start" && <Loader2 className="animate-spin" aria-hidden="true" />}Start video recap</Button>
  </section>;
  return <Dialog open={recap.open} onOpenChange={recap.setOpen}>
    <DialogContent data-testid="video-recap-dialog" className="video-recap-dialog">
      <DialogHeader className="recap-header">
        <p className="recap-eyebrow">Cueveris · Video understanding</p>
        <DialogTitle>Video recap</DialogTitle>
        <DialogDescription>{job?.source.name || a.sourceName || "Uploaded video"}</DialogDescription>
      </DialogHeader>
      <div className="recap-body">
        {!recap.eligible && <p className="recap-notice">{a.useMock ? "Turn off Demo mode before starting a real analysis." : "Connect an AI backend and upload a video to create a recap. The public preview does not run analysis."}</p>}
        {recap.error && <p role="alert" className="recap-error">{recap.error}</p>}
        {job && <>
          {job.provenance.simulated && <p className="recap-notice">Demo / simulated analysis. These records are not real provider observations.</p>}
          <VideoRecapProgress job={job} />
          {job.domain && <section className="recap-domain" aria-label="Process domain explanation">
            <span className="recap-eyebrow">{job.domain.basis === "operator" ? "Operator-selected domain" : "Inferred process domain"}</span><h3>{job.domain.label}</h3>
            <p>{job.domain.rationale}</p><p className="recap-small">Basis: {job.domain.basis === "both" ? "video and instructions" : job.domain.basis === "document" ? "reference instructions" : job.domain.basis === "unclear" ? "unclear; review required" : job.domain.basis}.</p>
            {job.domain.conflict && <p className="recap-notice">{job.domain.conflict}</p>}
          </section>}
          {recap.ownsUploadedAnalysis && <p className="recap-small">Automatic uploaded-video guidance stays paused for this recap. Existing confirmations are preserved. Resume guidance after analysis, or change the source or instructions.</p>}
          {recap.guidanceResumed && <p className="recap-small">Guidance is available again. The saved recap remains available for these inputs.</p>}
          {recap.active && <Button className="recap-action" variant="outline" disabled={!!recap.actionBusy} onClick={() => void recap.cancel()}>Cancel video recap</Button>}
          {job.error && <p className="recap-error">{job.error}</p>}
          {job.status === "partial" && <p className="recap-notice">Some intervals could not be analyzed. This partial result preserves the accepted evidence and its limitations.</p>}
          {job.status === "stale" && <p className="recap-notice">The source, instructions or goals changed. Start a fresh recap for the current inputs.</p>}
          {(["partial", "failed"].includes(job.status)) && <Button className="recap-action" variant="outline" disabled={!!recap.actionBusy || !recap.eligible} onClick={() => void recap.retry()}>Retry failed windows</Button>}
          {job.summary && <section className="recap-overview" aria-label="Final video summary"><span className="recap-eyebrow">{result ? "The resulting picture" : "Accepted observations"}</span><h2>{job.summary.headline}</h2><p>{job.summary.overview}</p></section>}
          {!!job.metrics.length && <section aria-label="Domain metrics" className="recap-metrics">{orderedMetrics.map(metric => <article key={metric.id}>
            <span className={`recap-metric-status ${metric.status}`}>{metric.status}</span><h3>{metric.label}</h3>
            <p className="recap-metric-value">{metric.value === null ? "Unavailable" : new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(metric.value)}{metric.value !== null && <span>{metric.unit}</span>}</p>
            <p>{metric.explanation}</p><details><summary>How this is supported</summary><p>{metric.method}</p>{citations(metric.evidence_refs)}</details>
          </article>)}</section>}
          {!!job.summary?.chapters.length && <section className="recap-chapters" aria-label="Video chapters"><div className="recap-section-head"><h3>A timeline of the work.</h3></div>{job.summary.chapters.map(chapter => <article key={chapter.id}>
            <button className="recap-chapter-time" type="button" aria-label={`Review chapter ${chapter.title}`} onClick={() => seek(chapter.start_s)}><Play aria-hidden="true" />{recapTime(chapter.start_s)}–{recapTime(chapter.end_s)}</button>
            <h4>{chapter.title}</h4><p>{chapter.summary}</p>{citations(chapter.evidence_refs)}
          </article>)}</section>}
          {!!job.summary?.key_findings.length && <section className="recap-findings" aria-label="Key findings"><h3>What to take forward.</h3>{job.summary.key_findings.map((finding, index) => <article key={index}><p>{finding.text}</p>{citations(finding.evidence_refs)}</article>)}</section>}
          {!!evidenceIds.length && <div ref={evidence} role="region" tabIndex={-1} data-testid="video-recap-evidence" className="recap-evidence" aria-label="Recap evidence detail">{evidenceIds.map(id => { const record = recapEvidence(job, id); return <article key={id}><span className="recap-eyebrow">Retained evidence · {id}</span><h4>{record?.title || "Evidence is unavailable in this result"}</h4><p>{record?.text || "This reference has no retained record. No facts have been inferred."}</p>{!!record?.supportingRefs?.length && <><p className="recap-small">Source samples supporting this finding</p>{citations(record.supportingRefs)}</>}{record && <Button variant="outline" className="recap-action" onClick={() => seek(record.time)}>Review this moment in video</Button>}</article>; })}</div>}
          <section className="recap-windows" aria-label="Accepted analysis windows"><details><summary>Inspect {job.windows.length} processed windows</summary>{job.windows.map(window => <article key={window.id}><h4>{recapTime(window.start_s)}–{recapTime(window.end_s)} · {window.status === "failed" ? "Failed interval" : window.phase || "Observed window"}</h4><p>{window.error || window.summary}</p>{window.events.map(event => <div key={event.id}><h5>{event.label} <span>· {event.certainty}</span></h5><p>{event.detail}</p>{event.uncertainty && <p className="recap-small">{event.uncertainty}</p>}{citations([event.id])}</div>)}{window.uncertainties.map((text, index) => <p key={index} className="recap-small">{text}</p>)}</article>)}</details></section>
          <section className="recap-limitations" aria-label="Analysis limitations"><h3>What this can establish.</h3><p>Visual findings use sampled frames. Instructions describe expectations; they do not prove an action happened. Counts and phase spans may be estimates or lower bounds.</p>{job.summary?.limitations.map((text, index) => <p key={index}>{text}</p>)}<p>Audio: {job.audio.status.replace("_", " ")}{job.audio.note ? ` · ${job.audio.note}` : ""}.</p><p className="recap-small">{job.model.model_id} · {job.provenance.model_calls} actual model calls · {job.source.width}×{job.source.height} · {recapTime(job.source.duration_s)}</p></section>
        </>}
        {result ? <details className="recap-new-analysis"><summary>Change domain or analysis settings</summary>{options}</details> : options}
      </div>
      <div className="recap-footer">
        <div><label className="recap-check"><input type="checkbox" checked={recap.narrationEnabled} disabled={!job || !recap.eligible} onChange={event => recap.setNarrationEnabled(event.target.checked)} />Narrate during playback</label><p className="recap-small">{speechPhase === "blocked" ? "Audio is waiting for a click or key press." : speechPhase === "speaking" && recap.narratingWindow ? "Speaking an accepted window at playback time." : "Opt in to a narrator that follows playback."}</p></div>
        <div className="recap-footer-actions">{job && !recapIsActive(job) && recap.ownsUploadedAnalysis && <Button className="recap-action" variant="outline" disabled={!!recap.actionBusy} onClick={recap.resumeGuidance}>Resume guidance</Button>}{result && <Button className="recap-action" disabled={!!recap.actionBusy} onClick={() => void recap.download()}><FileJson aria-hidden="true" />Download recap JSON</Button>}<ReportLauncher><Button className="recap-action" variant="outline">Open workflow report</Button></ReportLauncher></div>
      </div>
    </DialogContent>
  </Dialog>;
}
