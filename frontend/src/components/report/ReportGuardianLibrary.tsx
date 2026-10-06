import { useEffect, useMemo, useRef, useState } from "react";
import { Download, Loader2, Play, Share2 } from "lucide-react";
import { apiFetch } from "@/lib/api";
import type { ReviewEvent, ReviewResponse } from "@/lib/reviewTypes";
import { Button } from "@/components/ui/button";
import { downloadReport, shareReport } from "@/lib/reportShare";
import { formatReportTime } from "@/lib/reportInsights";
import { guardianFindings } from "@/lib/guardianFindings";

const clock = formatReportTime;

/** A catalog of recorded concerns, with one explicitly requested video preview. */
export function ReportGuardianLibrary({
  review,
  apiBase,
  videoAvailable,
}: {
  review: ReviewResponse | null;
  apiBase: string;
  videoAvailable: boolean;
}) {
  const findings = useMemo(() => guardianFindings(review), [review]);
  const [filter, setFilter] = useState("all");
  const [limit, setLimit] = useState(12);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [clip, setClip] = useState<{
    event: ReviewEvent;
    file: File;
    url: string;
    context: string;
  } | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [sharing, setSharing] = useState(false);
  const active = useRef<AbortController>();
  const mediaUrl = useRef<string>();
  const preview = useRef<HTMLDivElement>(null);
  const player = useRef<HTMLVideoElement>(null);
  const context = `${apiBase}|${review?.source_id}|${review?.reference_key}|${videoAvailable}`;
  const owner = useRef(context);
  owner.current = context;
  useEffect(() => {
    setClip(null);
    setError("");
    setNotice("");
    setBusyId(null);
    setFilter("all");
    setLimit(12);
    setSharing(false);
    return () => {
      active.current?.abort();
      if (mediaUrl.current) URL.revokeObjectURL(mediaUrl.current);
      mediaUrl.current = undefined;
    };
  }, [context]);
  useEffect(() => {
    if (clip && !findings.some((event) => event.id === clip.event.id)) {
      if (mediaUrl.current) URL.revokeObjectURL(mediaUrl.current);
      mediaUrl.current = undefined;
      setClip(null);
    }
  }, [clip, findings]);
  useEffect(() => {
    const video = player.current;
    return () => {
      if (video) {
        video.pause();
        video.removeAttribute("src");
        video.load();
      }
    };
  }, [clip?.url]);
  useEffect(() => {
    if (clip) {
      preview.current?.scrollIntoView?.({
        behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
          ? "instant"
          : "smooth",
        block: "nearest",
      });
      preview.current?.focus({ preventScroll: true });
    }
  }, [clip]);
  const load = async (event: ReviewEvent) => {
    if (!review || !videoAvailable) return;
    active.current?.abort();
    const controller = new AbortController();
    active.current = controller;
    const requested = context;
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, 35_000);
    setBusyId(event.id);
    setError("");
    setNotice("");
    try {
      const query = new URLSearchParams({
        source_id: review.source_id,
        reference_key: review.reference_key,
      });
      const response = await apiFetch(
        `${apiBase}/api/review/incidents/${encodeURIComponent(event.id)}/clip?${query}`,
        { signal: controller.signal },
      );
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(
          data.error || `Clip preparation failed (${response.status}).`,
        );
      }
      if (!response.headers.get("Content-Type")?.startsWith("video/mp4"))
        throw new Error("The server did not return a playable video clip.");
      const blob = await response.blob();
      if (controller.signal.aborted || owner.current !== requested) return;
      if (!blob.size || blob.size > 20 * 1024 * 1024)
        throw new Error(
          "The clip is empty or exceeds the download size limit.",
        );
      const file = new File(
        [blob],
        `guardian-${event.status}-${clock(event.video_time_s).replace(":", "m")}s.mp4`,
        { type: "video/mp4" },
      );
      if (mediaUrl.current) URL.revokeObjectURL(mediaUrl.current);
      const url = URL.createObjectURL(file);
      mediaUrl.current = url;
      setClip({ event, file, url, context: requested });
      setNotice(
        "Clip ready. Play, download or share it with your next reviewer.",
      );
    } catch (failure) {
      if (
        owner.current === requested &&
        (!controller.signal.aborted || timedOut)
      )
        setError(
          timedOut
            ? "Clip preparation timed out. Try again; the recorded finding remains available."
            : (failure as Error).message,
        );
    } finally {
      clearTimeout(timer);
      if (owner.current === requested && active.current === controller)
        setBusyId(null);
    }
  };
  const share = async () => {
    if (!clip) return;
    const requested = context;
    setSharing(true);
    setError("");
    setNotice("");
    try {
      const result = await shareReport(
        clip.file,
        "Cueveris Guardian clip",
      );
      if (owner.current === requested)
        setNotice(
          result === "downloaded"
            ? "Clip downloaded. Attach it in your messaging app."
            : result === "shared"
              ? "Clip handed to your device’s share menu."
              : "",
        );
    } catch (failure) {
      if (owner.current === requested)
        setError(
          `Clip sharing failed: ${(failure as Error).message}. Download the clip instead.`,
        );
    } finally {
      if (owner.current === requested) setSharing(false);
    }
  };
  const filtered = findings.filter(
    (event) => filter === "all" || event.status === filter,
  );
  return (
    <div className="report-guardian-library min-w-0">
      <p className="mb-3 text-sm leading-relaxed text-muted-foreground">
        Unusual observations and potential mistakes flagged by Guardian. These
        are findings for review, not confirmed errors. Each clip includes up to
        six seconds before and three seconds after the recorded moment.
      </p>
      {error && (
        <p
          role="alert"
          className="mb-3 rounded-lg border border-destructive/20 bg-destructive/5 p-3 text-sm text-destructive"
        >
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="mb-3 text-sm text-primary">
          {notice}
        </p>
      )}
      {clip &&
        clip.context === context &&
        findings.some((event) => event.id === clip.event.id) && (
          <div
            ref={preview}
            className="mb-4 overflow-hidden rounded-xl border bg-card"
            role="region"
            aria-label="Guardian clip preview"
            tabIndex={-1}
          >
            <video
              key={clip.url}
              ref={player}
              src={clip.url}
              controls
              playsInline
              preload="metadata"
              className="aspect-video max-h-80 w-full bg-black"
            />
            <div className="p-4">
              <h4 className="text-sm font-semibold">
                {clock(clip.event.video_time_s)} · {clip.event.summary}
              </h4>
              <p className="mt-1 text-xs text-muted-foreground">
                {clip.event.status === "alert" ? "Alert" : "Watch"} ·{" "}
                {clip.event.provenance === "system"
                  ? "System check"
                  : "AI observation"}
                {clip.event.old_reference ? " · Earlier instructions" : ""}
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button
                  size="sm"
                  className="min-h-11 gap-2"
                  onClick={() => {
                    downloadReport(clip.file);
                    setNotice("Guardian clip downloaded.");
                  }}
                >
                  <Download className="size-4" />
                  Download clip
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="min-h-11 gap-2"
                  disabled={sharing}
                  onClick={() => void share()}
                >
                  <Share2 className="size-4" />
                  Share clip
                </Button>
              </div>
            </div>
          </div>
        )}
      {findings.length > 0 && (
        <label className="mb-3 block text-xs font-medium text-muted-foreground">
          Guardian finding type
          <select
            aria-label="Guardian finding type"
            value={filter}
            onChange={(event) => {
              setFilter(event.target.value);
              setLimit(12);
            }}
            className="mt-1 block min-h-11 rounded-lg border bg-background px-3 text-sm text-foreground"
          >
            <option value="all">All findings ({findings.length})</option>
            <option value="alert">Alerts</option>
            <option value="watch">Watches</option>
          </select>
        </label>
      )}
      {!videoAvailable && findings.length > 0 && (
        <p className="mb-3 rounded-lg bg-muted/40 p-3 text-sm text-muted-foreground">
          A server copy of the recorded video is required for chunks. Camera and
          screen sessions retain observations and captured frames; live footage
          is not recorded by Guardian.
        </p>
      )}
      {filtered.length ? (
        <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2">
          {filtered.slice(0, limit).map((event) => {
            const issues =
              review?.exceptions.filter(
                (issue) => issue.event_id === event.id,
              ) ?? [];
            return (
              <article key={event.id} className="min-w-0 rounded-xl border bg-card p-4">
                <div className="mb-2 flex flex-wrap gap-2 text-xs text-muted-foreground">
                  <span className="font-mono">{clock(event.video_time_s)}</span>
                  <span
                    className={
                      event.status === "alert"
                        ? "text-destructive"
                        : "text-warning"
                    }
                  >
                    {event.status === "alert" ? "Alert" : "Watch"}
                  </span>
                  <span>
                    {event.provenance === "system"
                      ? "System check"
                      : "AI observation"}
                  </span>
                </div>
                <h4 className="text-sm font-semibold leading-relaxed">
                  {event.summary || event.concern || "Guardian finding"}
                </h4>
                {event.concern && (
                  <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                    {event.concern}
                  </p>
                )}
                {event.old_reference && (
                  <p className="mt-2 text-xs text-warning">
                    Recorded against earlier instructions
                  </p>
                )}
                {issues.map((issue) => (
                  <p
                    key={issue.id}
                    className="mt-2 text-xs leading-relaxed text-muted-foreground"
                  >
                    Review decision:{" "}
                    <span className="capitalize">{issue.status}</span> ·{" "}
                    {issue.title}
                  </p>
                ))}
                <Button
                  size="sm"
                  variant="outline"
                  className="mt-3 min-h-11 gap-2"
                  disabled={!videoAvailable || !!busyId}
                  onClick={() => void load(event)}
                  aria-label={`Prepare clip at ${clock(event.video_time_s)}`}
                >
                  {busyId === event.id ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <Play className="size-4" />
                  )}
                  {busyId === event.id ? "Preparing clip…" : "Prepare clip"}
                </Button>
              </article>
            );
          })}
        </div>
      ) : (
        <p className="rounded-xl border border-dashed bg-muted/25 p-4 text-sm leading-relaxed text-muted-foreground">
          {findings.length
            ? "No Guardian findings match this filter."
            : "No unusual observations or alerts were retained for this source. This does not establish that the process was free of mistakes."}
        </p>
      )}
      {filtered.length > limit && (
        <Button
          size="sm"
          variant="outline"
          className="mt-4 min-h-11"
          onClick={() => setLimit((value) => value + 12)}
        >
          Show more findings ({filtered.length - limit} remaining)
        </Button>
      )}
    </div>
  );
}
