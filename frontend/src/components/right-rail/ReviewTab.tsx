import { useEffect, useRef, useState } from "react";
import {
  BookmarkPlus,
  Play,
  RefreshCw,
  ShieldAlert,
  History,
} from "lucide-react";
import { useApp } from "@/lib/store";
import { grabFrame } from "@/lib/frameBus";
import type { ReviewException } from "@/lib/reviewTypes";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ReportLauncher } from "@/components/ReportLauncher";

const clock = (s: number) =>
  `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
function Issue({ issue }: { issue: ReviewException }) {
  const a = useApp();
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const context = `${a.sourceId}|${a.review?.reference_key}`;
  const owner = useRef(context);
  owner.current = context;
  const update = async (status: ReviewException["status"]) => {
    try {
      await a.updateReviewException(issue.id, status, note);
      if (owner.current === context) {
        setNote("");
        setError("");
      }
    } catch (e) {
      if (owner.current === context && (e as Error).name !== "AbortError")
        setError((e as Error).message);
    }
  };
  return (
    <article className="rounded-xl border bg-background p-3 space-y-2">
      <div className="flex flex-wrap items-center gap-2 text-[10px] uppercase tracking-wide text-muted-foreground">
        <span>{issue.status}</span>
        <span>
          ·{" "}
          {issue.provenance === "ai"
            ? "AI concern"
            : issue.provenance === "system"
              ? "System check"
              : "Operator issue"}
        </span>
        {issue.old_reference && <span>Earlier instructions</span>}
      </div>
      <h4 className="text-xs font-semibold break-words">{issue.title}</h4>
      {issue.description !== issue.title && (
        <p className="text-xs text-muted-foreground break-words">
          {issue.description}
        </p>
      )}
      <details className="text-xs">
        <summary className="cursor-pointer min-h-9 flex items-center">
          Decision history ({issue.history.length})
        </summary>
        <ol className="space-y-2 border-l pl-3">
          {issue.history.map((item, index) => (
            <li key={index}>
              <span className="font-medium">
                {item.status} · {item.operator || "Operator"}
              </span>
              <p className="text-muted-foreground break-words">{item.note}</p>
            </li>
          ))}
        </ol>
        {!!issue.history_omitted && (
          <p className="mt-2 text-muted-foreground">
            {issue.history_omitted} older updates were omitted by the session
            retention limit.
          </p>
        )}
      </details>
      <label className="block text-[11px]">
        Review note
        <Textarea
          aria-label={`Review note for ${issue.title}`}
          className="mt-1 min-h-16 text-xs"
          value={note}
          maxLength={1000}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Explain the decision or next action…"
        />
      </label>
      <div className="flex flex-wrap gap-2">
        {issue.status === "open" && (
          <Button
            size="sm"
            variant="outline"
            disabled={a.reviewBusy}
            onClick={() => void update("acknowledged")}
          >
            Acknowledge
          </Button>
        )}
        {issue.status !== "resolved" ? (
          <Button
            size="sm"
            disabled={a.reviewBusy || !note.trim()}
            onClick={() => void update("resolved")}
          >
            Resolve with note
          </Button>
        ) : (
          <Button
            size="sm"
            variant="outline"
            disabled={a.reviewBusy}
            onClick={() => void update("open")}
          >
            Reopen
          </Button>
        )}
      </div>
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
    </article>
  );
}
export function ReviewTab() {
  const a = useApp();
  const [bookmark, setBookmark] = useState("");
  const [title, setTitle] = useState("");
  const [error, setError] = useState("");
  const [showResolved, setShowResolved] = useState(false);
  const [view, setView] = useState<"evidence" | "exceptions">("evidence");
  const review = a.review;
  const { setReviewImagesEnabled } = a;
  useEffect(() => {
    setReviewImagesEnabled(true);
    return () => setReviewImagesEnabled(false);
  }, [setReviewImagesEnabled]);
  const context = `${a.sourceId}|${review?.reference_key}`;
  const owner = useRef(context);
  owner.current = context;
  useEffect(() => {
    setBookmark("");
    setTitle("");
    setError("");
  }, [a.sourceId, review?.reference_key]);
  const run = async (action: () => Promise<unknown>) => {
    try {
      await action();
      if (owner.current === context) setError("");
    } catch (e) {
      if (owner.current === context && (e as Error).name !== "AbortError")
        setError((e as Error).message);
    }
  };
  const saveBookmark = () =>
    run(async () => {
      const frame = grabFrame();
      if (!frame.b64)
        throw new Error(
          "A visible video or camera frame is needed for a bookmark.",
        );
      await a.addReviewBookmark({
        current_s: frame.currentS,
        frame_b64: frame.b64,
        note: bookmark,
      });
      setBookmark("");
    });
  return (
    <div className="space-y-3 pt-2">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold flex items-center gap-2">
            <History className="size-4 text-primary" /> Review workbench
          </h3>
          <p className="text-[11px] text-muted-foreground mt-1">
            Evidence, decisions and work to hand over.
          </p>
        </div>
        <Button
          size="icon"
          variant="ghost"
          aria-label="Refresh review"
          onClick={() => void a.refreshReview()}
          disabled={a.reviewLoading}
        >
          <RefreshCw className={a.reviewLoading ? "animate-spin" : ""} />
        </Button>
      </div>
      {(error || a.reviewError) && (
        <p role="alert" className="text-xs text-destructive">
          {error || a.reviewError}
        </p>
      )}
      {!a.sourceReady ? (
        <p className="text-xs text-muted-foreground">
          Load a video or connect a camera to begin a review.
        </p>
      ) : !review ? (
        <p className="text-xs text-muted-foreground">
          {a.reviewLoading
            ? "Loading review…"
            : "Refresh to load the current review."}
        </p>
      ) : (
        <>
          <div className="grid grid-cols-2 rounded-xl border p-1 gap-1">
            {(["evidence", "exceptions"] as const).map((id) => (
              <Button
                key={id}
                variant={view === id ? "secondary" : "ghost"}
                className="text-xs"
                onClick={() => setView(id)}
              >
                {id === "evidence"
                  ? `Evidence (${review.events.length})`
                  : `Exceptions (${review.exceptions.filter((i) => i.status !== "resolved").length})`}
              </Button>
            ))}
          </div>
          {view === "evidence" ? (
            <>
              <div className="rounded-xl border border-primary/20 bg-primary/5 p-3 space-y-2">
                <label className="text-xs block">
                  Bookmark this moment
                  <Input
                    aria-label="Evidence bookmark note"
                    className="mt-1 text-xs"
                    value={bookmark}
                    maxLength={2000}
                    onChange={(e) => setBookmark(e.target.value)}
                    placeholder="What should the next reviewer notice?"
                  />
                </label>
                <Button
                  size="sm"
                  disabled={a.reviewBusy}
                  onClick={() => void saveBookmark()}
                >
                  <BookmarkPlus /> Save frame
                </Button>
              </div>
              {!review.events.length && (
                <p className="text-xs text-muted-foreground p-3">
                  Observations and confirmed milestones appear here as the
                  process is analysed. You can also save a frame yourself.
                </p>
              )}
              {review.events
                .slice()
                .reverse()
                .map((event) => (
                  <article
                    key={event.id}
                    className="rounded-xl border overflow-hidden bg-background"
                  >
                    {event.thumbnail_b64 && (
                      <img
                        src={event.thumbnail_b64}
                        alt={`Captured evidence at ${clock(event.video_time_s)}`}
                        loading="lazy"
                        className="w-full max-h-44 object-contain bg-black/5"
                      />
                    )}
                    <div className="p-3 space-y-2">
                      <div className="flex flex-wrap gap-2 text-[10px] uppercase tracking-wide text-muted-foreground">
                        <span className="font-semibold text-primary">
                          {clock(event.video_time_s)}
                        </span>
                        <span>{event.kind}</span>
                        <span>
                          {event.provenance === "ai"
                            ? "AI observation"
                            : event.provenance === "operator"
                              ? "Operator bookmark"
                              : "System / demo"}
                        </span>
                        {event.observation_scope === "overview" && (
                          <span>Whole-video overview</span>
                        )}
                        {event.old_reference && (
                          <span>Earlier instructions</span>
                        )}
                      </div>
                      <p className="text-xs font-medium leading-relaxed break-words">
                        {event.summary}
                      </p>
                      {event.concern && (
                        <p className="text-xs text-amber-700 dark:text-amber-300 break-words">
                          {event.concern}
                        </p>
                      )}
                      <div className="flex flex-wrap gap-2">
                        {a.sourceKind === "video" &&
                          event.observation_scope !== "overview" && (
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={
                                event.source_id !== a.sourceId || !a.sourceReady
                              }
                              onClick={() =>
                                window.dispatchEvent(
                                  new CustomEvent("guidance-review-seek", {
                                    detail: {
                                      sourceId: event.source_id,
                                      timeS: event.video_time_s,
                                    },
                                  }),
                                )
                              }
                            >
                              <Play /> Replay moment
                            </Button>
                          )}
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={a.reviewBusy || event.old_reference}
                          onClick={() =>
                            void run(async () => {
                              await a.raiseReviewException({
                                title: (event.concern || event.summary).slice(
                                  0,
                                  180,
                                ),
                                description: event.guidance,
                                event_id: event.id,
                              });
                              setView("exceptions");
                            })
                          }
                        >
                          <ShieldAlert /> Raise issue
                        </Button>
                      </div>
                    </div>
                  </article>
                ))}
            </>
          ) : (
            <>
              <form
                className="rounded-xl border p-3 space-y-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  void run(async () => {
                    await a.raiseReviewException({ title });
                    setTitle("");
                  });
                }}
              >
                <label className="block text-xs">
                  New issue
                  <Input
                    aria-label="New exception title"
                    className="mt-1 text-xs"
                    value={title}
                    maxLength={180}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder="Blocker, uncertainty or follow-up"
                  />
                </label>
                <Button size="sm" disabled={a.reviewBusy || !title.trim()}>
                  Raise exception
                </Button>
              </form>
              <label className="flex items-center gap-2 text-xs min-h-10">
                <input
                  type="checkbox"
                  checked={showResolved}
                  onChange={(e) => setShowResolved(e.target.checked)}
                />
                Include resolved issues
              </label>
              {review.exceptions
                .filter((i) => showResolved || i.status !== "resolved")
                .map((issue) => (
                  <Issue
                    key={`${review.source_id}:${issue.id}`}
                    issue={issue}
                  />
                ))}
              {!review.exceptions.filter(
                (i) => showResolved || i.status !== "resolved",
              ).length && (
                <p className="text-xs text-muted-foreground p-3">
                  No open issues recorded.
                </p>
              )}
            </>
          )}
          <ReportLauncher>
            <Button variant="outline" className="w-full min-h-11">
              Open analysis report
            </Button>
          </ReportLauncher>
          <p className="text-[10px] text-muted-foreground leading-relaxed">
            {review.retention.dropped_events ||
            review.retention.dropped_thumbnails
              ? "Older evidence was trimmed to keep this session responsive. Export to preserve the retained evidence. "
              : ""}
            Review is scoped to this input and kept while the session is active.
            Export or save it to your account before leaving.
          </p>
        </>
      )}
    </div>
  );
}
