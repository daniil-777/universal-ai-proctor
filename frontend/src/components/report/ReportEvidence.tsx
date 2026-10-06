import { useEffect, useMemo, useRef, useState } from "react";
import { Camera, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { apiFetch } from "@/lib/api";
import type { ReviewResponse } from "@/lib/reviewTypes";
import type { Stage } from "@/lib/types";
import { currentReportReference, reportEventTime, reportProvenance, reportReferences } from "@/lib/reportInsights";
import { parseReviewPayload } from "@/lib/reviewPayload";

const photo = (value?: string) =>
  value &&
  value.length <= 52_000 &&
  /^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(value)
    ? value
    : undefined;
const provenance = reportProvenance;

/** Retained records only; photos use an explicit, bounded, source-checked read. */
export function ReportEvidence({
  review,
  apiBase,
  stages = [],
  onStep,
  requestedEvent,
}: {
  review: ReviewResponse | null;
  apiBase: string;
  stages?: Stage[];
  onStep?: (stepId: string) => void;
  requestedEvent?: { id: string; request: number; sourceId: string };
}) {
  const [filter, setFilter] = useState("all");
  const [limit, setLimit] = useState(12);
  const [photos, setPhotos] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const controller = useRef<AbortController>();
  const records = useRef<HTMLDivElement>(null);
  const completedRequest = useRef<string>();
  const context = `${apiBase}|${review?.source_id}|${review?.reference_key}`;
  const owner = useRef(context);
  owner.current = context;
  useEffect(() => {
    setPhotos({});
    setBusy(false);
    setError("");
    setFilter("all");
    setLimit(12);
    return () => controller.current?.abort();
  }, [context]);
  const events = useMemo(() => review?.events.filter(event => event.source_id === review.source_id) ?? [], [review]);
  const references = useMemo(() => reportReferences(review), [review]);
  useEffect(() => {
    if (!requestedEvent || requestedEvent.sourceId !== review?.source_id || !events.some(event => event.id === requestedEvent.id)) return;
    const requestKey = `${context}|${requestedEvent.request}`;
    if (completedRequest.current === requestKey) return;
    completedRequest.current = requestKey;
    setFilter("all");
    const index = events.slice().reverse().findIndex(event => event.id === requestedEvent.id);
    setLimit(value => Math.max(value, Math.ceil((index + 1) / 12) * 12));
  }, [requestedEvent, events, context, review?.source_id]);
  useEffect(() => {
    if (!requestedEvent || requestedEvent.sourceId !== review?.source_id) return;
    const frame = requestAnimationFrame(() => {
      const target = [...(records.current?.querySelectorAll<HTMLElement>("[data-report-event]") ?? [])]
        .find(element => element.dataset.reportEvent === requestedEvent.id);
      target?.scrollIntoView?.({ block: "nearest", behavior: "instant" });
      target?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [requestedEvent, limit, filter, review?.source_id]);
  const filtered = events
    .filter((event) => filter === "all" || event.kind === filter)
    .slice()
    .reverse();
  const missing = events.some(
    (event) =>
      event.thumbnail_available &&
      !photo(event.thumbnail_b64) &&
      !photos[event.id],
  );
  const loadPhotos = async () => {
    if (!review) return;
    controller.current?.abort();
    const active = new AbortController();
    controller.current = active;
    const requested = context;
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      active.abort();
    }, 15_000);
    setBusy(true);
    setError("");
    try {
      const response = await apiFetch(
        `${apiBase}/api/review?include_images=true`,
        { signal: active.signal },
      );
      if (!response.ok)
        throw new Error(
          `Evidence photos could not be loaded (${response.status}).`,
        );
      const data = parseReviewPayload(await response.json());
      if (active.signal.aborted || owner.current !== requested) return;
      if (
        !data.ok ||
        data.source_id !== review.source_id ||
        data.reference_key !== review.reference_key ||
        data.review_version < review.review_version ||
        !Array.isArray(data.events)
      )
        throw new Error(
          "The source or instructions changed. Refresh the report before loading photos.",
        );
      const images: Record<string, string> = {};
      for (const event of data.events) {
        const value = photo(event.thumbnail_b64);
        if (event.source_id === review.source_id && value)
          images[event.id] = value;
      }
      setPhotos(images);
      if (!Object.keys(images).length)
        setError(
          "No photos are retained for these records. The text evidence remains available.",
        );
    } catch (failure) {
      if (owner.current === requested && (!active.signal.aborted || timedOut))
        setError(
          timedOut
            ? "Evidence photos timed out. Try again; text records remain available."
            : (failure as Error).message,
        );
    } finally {
      clearTimeout(timer);
      if (owner.current === requested && controller.current === active)
        setBusy(false);
    }
  };
  return (
    <div>
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <label className="text-xs font-medium text-muted-foreground">
          Evidence type
          <select
            aria-label="Evidence type"
            value={filter}
            onChange={(event) => {
              setFilter(event.target.value);
              setLimit(12);
            }}
            className="mt-1 block min-h-11 rounded-lg border bg-background px-3 text-sm text-foreground"
          >
            <option value="all">All evidence ({events.length})</option>
            <option value="bookmark">Bookmarks</option>
            <option value="observation">Observations</option>
            <option value="milestone">Milestones</option>
          </select>
        </label>
        {missing && (
          <Button
            size="sm"
            variant="outline"
            className="min-h-11 gap-2"
            disabled={busy}
            onClick={() => void loadPhotos()}
          >
            {busy ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Camera className="size-4" />
            )}
            Load evidence photos
          </Button>
        )}
      </div>
      {error && (
        <p
          role="alert"
          className="mb-3 rounded-lg border border-destructive/20 bg-destructive/5 p-3 text-sm text-destructive"
        >
          {error}
        </p>
      )}
      <p className="mb-3 text-xs text-muted-foreground">
        Latest retained records first. Timestamps identify recorded moments, not
        continuous video coverage.
      </p>
      {filtered.length ? (
        <div ref={records} className="grid gap-3 sm:grid-cols-2">
          {filtered.slice(0, limit).map((event) => {
            const duration = review?.source_duration_s;
            const invalidTimestamp = !Number.isFinite(event.video_time_s) || event.video_time_s < 0;
            const outsideDuration = typeof duration === "number" && Number.isFinite(duration) && duration > 0 && event.video_time_s > duration;
            const image =
              photo(event.thumbnail_b64) ||
              (event.thumbnail_available ? photos[event.id] : undefined);
            return (
              <article
                key={event.id}
                className={`report-evidence-card overflow-hidden rounded-xl border bg-card ${requestedEvent?.sourceId === review?.source_id && requestedEvent?.id === event.id ? "report-record-selected" : ""}`}
                data-report-event={event.id}
                tabIndex={-1}
                aria-label={`${references.get(event.id)?.label} · ${event.summary || "Evidence record"}`}
              >
                {image && (
                  <figure className="border-b bg-muted/20">
                    <img
                      src={image}
                      alt={`Captured evidence at ${reportEventTime(event)}: ${event.summary}`}
                      className="aspect-video w-full object-contain"
                      loading="lazy"
                      decoding="async"
                    />
                    <figcaption className="px-4 py-2 text-xs text-muted-foreground">
                      {event.observation_scope === "overview"
                        ? "Overview sample"
                        : "Captured frame"}{" "}
                      · {reportEventTime(event)}
                    </figcaption>
                  </figure>
                )}
                <div className="p-4">
                  <div className="mb-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                    <b className="report-reference-label">{references.get(event.id)?.label}</b>
                    <span className="font-mono">
                      {reportEventTime(event)}
                    </span>
                    <span>{provenance(event)}</span>
                    <span
                      className={`rounded px-1.5 py-0.5 capitalize ${event.status === "alert" ? "bg-destructive/10 text-destructive" : event.status === "watch" ? "bg-warning/10 text-warning" : "bg-muted"}`}
                    >
                      {event.status}
                    </span>
                  </div>
                  <h4 className="text-sm font-medium leading-relaxed">
                    {event.summary || "Evidence record"}
                  </h4>
                  {(invalidTimestamp || outsideDuration) && <p className="report-retention-note">Excluded from timeline: {invalidTimestamp ? "no valid source timestamp." : "timestamp is outside the known source duration."}</p>}
                  {event.concern && (
                    <p className="mt-2 text-sm leading-relaxed text-warning">
                      {event.concern}
                    </p>
                  )}
                  {event.guidance && (
                    <details className="mt-2 text-sm">
                      <summary className="flex min-h-11 cursor-pointer items-center text-primary">
                        Recorded guidance
                      </summary>
                      <p className="mt-1 text-muted-foreground">
                        {event.guidance}
                      </p>
                    </details>
                  )}
                  <div className="mt-3 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
                    <span className="capitalize">{event.kind}</span>
                    {event.operator && <span>{event.operator}</span>}
                    {event.model && <span>{event.model}</span>}
                    {event.observation_scope === "overview" && (
                      <span>Whole-video overview</span>
                    )}
                    {review && !currentReportReference(event, review) && (
                      <span className="text-warning">Earlier instructions</span>
                    )}
                  </div>
                  {!!event.step_ids.length && <div className="report-evidence-links">
                    {review && currentReportReference(event, review) ? [...new Set(event.step_ids)].map(id => {
                      const step = stages.find(item => item.id === id);
                      return step && onStep ? <button key={id} type="button" onClick={() => onStep(id)} aria-label={`View workflow step ${step.name}`}>{step.name}</button>
                        : <span key={id}>Linked step is not available in this workflow.</span>;
                    }) : <p>Step links belong to earlier instructions.</p>}
                  </div>}
                  <details className="report-record-details"><summary>Record details</summary>
                    <dl><div><dt>Record identifier</dt><dd>{event.id}</dd></div><div><dt>Recorded at</dt><dd>{new Date(event.occurred_at).toLocaleString()}</dd></div>
                      <div><dt>Reference digest</dt><dd>{event.reference_key}</dd></div></dl>
                  </details>
                  {!image && event.thumbnail_available && (
                    <p className="mt-2 text-xs text-muted-foreground">
                      Photo retained; load evidence photos to view it.
                    </p>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      ) : (
        <p className="rounded-xl border border-dashed bg-muted/25 p-4 text-sm leading-relaxed text-muted-foreground">
          {events.length
            ? "No retained records match this evidence type."
            : "No evidence records were retained for this source. Save a frame or run guidance to begin a recorded review."}
        </p>
      )}
      {filtered.length > limit && (
        <Button
          size="sm"
          variant="outline"
          className="mt-4 min-h-11"
          onClick={() => setLimit((value) => value + 12)}
        >
          Show more evidence ({filtered.length - limit} remaining)
        </Button>
      )}
      {!!review?.retention && (
        <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
          Retained {review.retention.retained_events} records and{" "}
          {review.retention.retained_thumbnails} photos. Omitted by retention
          limits: {review.retention.dropped_events} records,{" "}
          {review.retention.dropped_thumbnails} photos,{" "}
          {review.retention.dropped_exceptions} issues. Exports include every
          retained record.
        </p>
      )}
    </div>
  );
}
