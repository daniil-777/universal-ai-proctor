import { apiFetch, mediaUrl } from "@/lib/api";
// Source-scoped review, explicit confirmation origins, retained evidence and exports.
// The optional debrief summarizes recorded data; it does not perform new AI analysis.
// Session-wide chat/telemetry remain separately labeled in the detailed print view.

import { useEffect, useMemo, useRef, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useApp } from "@/lib/store";
import type { GuardianEntry } from "@/lib/store";
import {
  ReportOverview,
  type ReportSection,
} from "@/components/report/ReportOverview";
import { ReportEvidence } from "@/components/report/ReportEvidence";
import { ReportGuardianLibrary } from "@/components/report/ReportGuardianLibrary";
import { guardianFindings } from "@/lib/guardianFindings";
import {
  AlertTriangle,
  CheckCircle2,
  FileText,
  Download,
  Share2,
  Loader2,
  MessageSquare,
  Printer,
  RefreshCw,
  ShieldAlert,
  Video,
  ChevronDown,
  Activity,
} from "lucide-react";
import { toast } from "sonner";
import {
  canShareReport,
  downloadReport,
  reportFilename,
  shareReport,
} from "@/lib/reportShare";

interface RecordedDebrief {
  overall: string;
  to_improve: string[];
  done_properly: string[];
  qa_summary: string;
}

interface QaPair {
  q: string;
  a: string;
  ts: number;
}

const fmtClock = (ts: number) =>
  new Date(ts).toLocaleTimeString([], { hour12: false });
const fmtVideo = (s: number) =>
  `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

/** Normalized polyline points for a minimal sparkline (single series, 2px line). */
function sparkPoints(trend: number[], w = 120, h = 26, pad = 2): string {
  if (trend.length < 2) return "";
  const min = Math.min(...trend);
  const max = Math.max(...trend);
  const span = max - min || 1;
  return trend
    .map((v, i) => {
      const x = pad + (i / (trend.length - 1)) * (w - pad * 2);
      const y = h - pad - ((v - min) / span) * (h - pad * 2);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
}

const escapeHtml = (s: string) =>
  s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

const SectionTitle = ({
  icon,
  title,
  description,
  action,
}: {
  icon: React.ReactNode;
  title: string;
  description?: string;
  action?: React.ReactNode;
}) => (
  <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
    <div className="flex min-w-0 items-start gap-3">
      <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
        {icon}
      </span>
      <div className="min-w-0">
        <h3 className="text-base font-semibold tracking-tight">{title}</h3>
        {description && (
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            {description}
          </p>
        )}
      </div>
    </div>
    {action}
  </div>
);

export function ReportDialog({
  children,
  controlledOpen,
  onOpenChange,
}: {
  children: React.ReactNode;
  controlledOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const a = useApp();
  const review = a.review?.source_id === a.sourceId ? a.review : null;
  const [internalOpen, setInternalOpen] = useState(false);
  const open = controlledOpen ?? internalOpen;
  const setOpen = (value: boolean) => {
    setInternalOpen(value);
    onOpenChange?.(value);
  };
  const [showResolved, setShowResolved] = useState(false);
  const [showClips, setShowClips] = useState(false);
  const body = useRef<HTMLDivElement>(null);
  const navigate = (section: ReportSection) => {
    const target = body.current?.querySelector<HTMLElement>(
      `[data-report-section="${section}"]`,
    );
    target?.scrollIntoView({
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
        ? "instant"
        : "smooth",
      block: "start",
    });
    target?.focus({ preventScroll: true });
  };
  const [ai, setAi] = useState<RecordedDebrief | null>(null);
  const [aiBusy, setAiBusy] = useState(false);
  const [aiError, setAiError] = useState("");
  const [prepared, setPrepared] = useState<{
    file: File;
    version: number;
  } | null>(null);
  const [exportBusy, setExportBusy] = useState<"pdf" | "html" | null>(null);
  const [exportError, setExportError] = useState("");
  const [exportNotice, setExportNotice] = useState("");
  const [shareBusy, setShareBusy] = useState(false);
  const [printError, setPrintError] = useState("");
  const context = `${a.apiBase}|${a.sourceId}|${a.referenceName}|${a.review?.reference_key ?? ""}|${a.revision}|${a.preferencesRevision}`;
  const latestContext = useRef(context);
  latestContext.current = context;
  const summaryController = useRef<AbortController | null>(null);
  const exportController = useRef<AbortController | null>(null);

  useEffect(() => {
    setAi(null);
    setAiBusy(false);
    setAiError("");
    setPrepared(null);
    setExportBusy(null);
    setExportError("");
    setExportNotice("");
    setShareBusy(false);
    setPrintError("");
    setShowResolved(false);
    setShowClips(false);
    return () => {
      summaryController.current?.abort();
      exportController.current?.abort();
    };
  }, [context]);

  useEffect(() => {
    const invalidate = () => {
      summaryController.current?.abort();
      exportController.current?.abort();
      setAi(null);
      setAiBusy(false);
      setAiError("");
      setPrepared(null);
      setExportBusy(null);
      setExportNotice("");
    };
    window.addEventListener("guidance-reference-updated", invalidate);
    return () =>
      window.removeEventListener("guidance-reference-updated", invalidate);
  }, []);

  const currentGuardian = useMemo(
    () => a.guardianLog.filter((e) => e.sourceId === a.sourceId),
    [a.guardianLog, a.sourceId],
  );

  // ── Session data ────────────────────────────────────────────────────────────
  const alerts = useMemo(
    () => currentGuardian.filter((e) => e.status === "alert"),
    [currentGuardian],
  );
  const watches = useMemo(
    () => currentGuardian.filter((e) => e.status === "watch"),
    [currentGuardian],
  );

  const qaPairs = useMemo<QaPair[]>(() => {
    const out: QaPair[] = [];
    for (let i = 0; i < a.chat.length; i++) {
      const m = a.chat[i]!;
      if (m.role !== "user") continue;
      const nextUser = a.chat.findIndex(
        (x, index) => index > i && x.role === "user",
      );
      const ans = a.chat
        .slice(i + 1, nextUser < 0 ? undefined : nextUser)
        .find((x) => x.role === "assistant" && !x.streaming && !!x.text);
      if (ans && !ans.text.startsWith("⚠") && !ans.text.startsWith("🛡️")) {
        out.push({ q: m.text, a: ans.text, ts: m.ts });
      }
    }
    return out;
  }, [a.chat]);

  const serverSideVideo = a.sourceKind === "video" && a.serverVideoReady;
  const clipEntries = useMemo(
    () =>
      alerts
        .filter(
          (e) =>
            e.sourceId === a.sourceId &&
            e.sourceKind === "video" &&
            typeof e.videoS === "number" &&
            e.videoS! >= 0,
        )
        .slice(-8),
    [alerts, a.sourceId],
  );
  const clipUrl = (e: GuardianEntry) => {
    const start = Math.max(0, (e.videoS ?? 0) - 6);
    const end = (e.videoS ?? 0) + 2;
    return mediaUrl(
      a.apiBase,
      `/api/video/clip?start_s=${start.toFixed(1)}&end_s=${end.toFixed(1)}&source_id=${encodeURIComponent(a.sourceId)}`,
    );
  };

  // ── Recorded debrief (no new model call) ────────────────────────────────────
  const genSummary = async () => {
    summaryController.current?.abort();
    const controller = new AbortController();
    summaryController.current = controller;
    const owner = context;
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, 30_000);
    setAiBusy(true);
    setAiError("");
    try {
      const res = await apiFetch(`${a.apiBase}/api/report/summary`, {
        method: "POST",
        signal: controller.signal,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          case_name: a.caseName,
          guardian: currentGuardian.map((e) => ({
            ts: e.ts,
            status: e.status,
            text: e.text,
          })),
          qa: qaPairs.map((p) => ({ q: p.q, a: p.a })),
        }),
      });
      const j = await res.json();
      if (controller.signal.aborted || latestContext.current !== owner) return;
      if (!res.ok || !j.ok)
        throw new Error(j.detail ?? j.error ?? "summary failed");
      if (
        typeof j.overall !== "string" ||
        typeof j.qa_summary !== "string" ||
        !Array.isArray(j.to_improve) ||
        !Array.isArray(j.done_properly) ||
        ![...j.to_improve, ...j.done_properly].every(
          (item) => typeof item === "string",
        )
      )
        throw new Error(
          "The server returned an invalid recorded debrief. Try again.",
        );
      setAi({
        overall: j.overall,
        to_improve: j.to_improve,
        done_properly: j.done_properly,
        qa_summary: j.qa_summary,
      });
    } catch (err) {
      if (
        latestContext.current === owner &&
        (!controller.signal.aborted || timedOut)
      ) {
        setAiError(
          timedOut
            ? "Debrief preparation timed out. Try again, or export the recorded report without a debrief."
            : `Debrief could not be prepared: ${(err as Error).message}`,
        );
      }
    } finally {
      clearTimeout(timer);
      if (
        summaryController.current === controller &&
        latestContext.current === owner
      )
        setAiBusy(false);
    }
  };

  useEffect(() => {
    if (!open) {
      summaryController.current?.abort();
      exportController.current?.abort();
      setShowClips(false);
    }
  }, [open]);

  const prepareReport = async (format: "pdf" | "html") => {
    if (!review || review.source_id !== a.sourceId || !a.sourceReady) {
      setExportError("Wait for the current source review to load.");
      return;
    }
    exportController.current?.abort();
    const controller = new AbortController();
    exportController.current = controller;
    const owner = context;
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, 30_000);
    setExportBusy(format);
    setExportError("");
    setExportNotice("");
    try {
      const query = new URLSearchParams({
        source_id: a.sourceId,
        reference_key: review.reference_key,
        review_version: String(review.review_version),
        revision: String(a.revision),
        preferences_revision: String(a.preferencesRevision),
      });
      const response = await apiFetch(
        `${a.apiBase}/api/review/report.${format}?${query}`,
        { signal: controller.signal },
      );
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(
          body.error || `Report preparation failed (${response.status})`,
        );
      }
      const blob = await response.blob();
      if (controller.signal.aborted || latestContext.current !== owner) return;
      if (!blob.size || blob.size > 30 * 1024 * 1024)
        throw new Error(
          "The report is empty or exceeds the download size limit.",
        );
      const file = new File([blob], reportFilename(a.caseName, format), {
        type: format === "pdf" ? "application/pdf" : "text/html",
      });
      if (format === "pdf") {
        setPrepared({ file, version: review.review_version });
        toast.success("PDF ready to download or share.");
      } else {
        downloadReport(file);
        setExportNotice("Offline HTML report downloaded.");
      }
    } catch (error) {
      if (
        latestContext.current === owner &&
        (!controller.signal.aborted || timedOut)
      ) {
        setExportError(
          timedOut
            ? "Report preparation timed out. Try again or download the offline HTML report."
            : (error as Error).message,
        );
        void a.refreshReview();
      }
    } finally {
      clearTimeout(timer);
      if (
        exportController.current === controller &&
        latestContext.current === owner
      )
        setExportBusy(null);
    }
  };

  const sharePrepared = async () => {
    if (!prepared) return;
    const owner = context;
    setShareBusy(true);
    setExportNotice("");
    setExportError("");
    try {
      const outcome = await shareReport(prepared.file);
      if (latestContext.current !== owner) return;
      if (outcome === "downloaded")
        setExportNotice("PDF downloaded. Attach it in your messaging app.");
      else if (outcome === "shared")
        setExportNotice("Report handed to your device’s share menu.");
    } catch (error) {
      if (latestContext.current === owner)
        setExportError(
          `Sharing failed: ${(error as Error).message}. You can download the PDF instead.`,
        );
    } finally {
      if (latestContext.current === owner) setShareBusy(false);
    }
  };

  // ── Printable version (standalone light-theme document) ─────────────────────
  const openPrintable = () => {
    setPrintError("");
    const w = window.open("", "_blank", "width=900,height=1000");
    if (!w) {
      setPrintError(
        "Print window was blocked. Allow popups for this site, or use PDF or Offline HTML.",
      );
      return;
    }
    w.document.write(buildPrintableHtml());
    w.opener = null;
    w.document.close();
  };

  const buildPrintableHtml = (): string => {
    const li = (items: string[]) =>
      items.map((x) => `<li>${escapeHtml(x)}</li>`).join("");
    const metricCards = (a.liveMetrics ?? [])
      .map(
        (m) => `
      <div class="tile">
        <div class="tlabel">${escapeHtml(m.label)}</div>
        <div class="tvalue">${escapeHtml(String(m.value))}${m.unit ? `<span class="tunit"> ${escapeHtml(m.unit)}</span>` : ""}</div>
        ${
          m.trend && m.trend.length > 1
            ? `<svg width="120" height="26" viewBox="0 0 120 26"><polyline points="${sparkPoints(m.trend)}" fill="none" stroke="#6b7280" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/></svg>`
            : ""
        }
      </div>`,
      )
      .join("");
    const alertRows = alerts
      .map(
        (e) => `
      <tr><td class="mono">${fmtClock(e.ts)}</td><td class="mono">${typeof e.videoS === "number" ? fmtVideo(e.videoS) : "—"}</td><td>${escapeHtml(e.text)}</td></tr>`,
      )
      .join("");
    const qaHtml = qaPairs
      .map(
        (p) => `
      <div class="qa"><div class="q"><span class="mono">${fmtClock(p.ts)}</span> Q: ${escapeHtml(p.q)}</div><div class="ans">${escapeHtml(p.a)}</div></div>`,
      )
      .join("");
    const clipsHtml =
      serverSideVideo && clipEntries.length
        ? clipEntries
            .map(
              (e) => `
        <figure class="clip">
          <video controls preload="none" src="${clipUrl(e)}"></video>
          <figcaption><span class="mono">video ${typeof e.videoS === "number" ? fmtVideo(e.videoS) : "—"}</span> — ${escapeHtml(e.text)}</figcaption>
        </figure>`,
            )
            .join("")
        : `<p class="muted">${alerts.length ? "Video shorts require an uploaded video on the backend." : "No alerts were recorded — no clips."}</p>`;

    return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Process Session Report — ${escapeHtml(a.caseName)}</title>
<style>
  * { box-sizing: border-box; }
  body { font: 14px/1.65 system-ui, -apple-system, "Segoe UI", sans-serif; color: #14283b; margin: 48px auto; max-width: 920px; padding: 0 28px; overflow-wrap: anywhere; }
  h1 { font-size: 32px; letter-spacing: -.04em; margin: 0 0 8px; color: #14283b; }
  h2 { font-size: 19px; letter-spacing: -.02em; margin: 32px 0 14px; padding-bottom: 10px; border-bottom: 1px solid #dce5ec; color: #14283b; }
  h3 { font-size: 14px; margin: 16px 0 8px; }
  .sub { color: #586879; font-size: 12px; margin-bottom: 6px; }
  .mono { font-family: ui-monospace, Consolas, monospace; font-size: 11px; color: #6b7280; }
  .muted { color: #6b7280; }
  .cols { display: flex; gap: 24px; } .col { flex: 1; }
  ul { margin: 4px 0; padding-left: 18px; } li { margin: 3px 0; }
  .improve li::marker { color: #b45309; } .good li::marker { color: #15803d; }
  table { width: 100%; table-layout: fixed; border-collapse: collapse; font-size: 12px; }
  td, th { padding: 10px 12px; border-bottom: 1px solid #dce5ec; text-align: left; vertical-align: top; overflow-wrap: anywhere; } th { background: #f1f5f8; color: #586879; font-size: 11px; }
  .qa { margin: 14px 0; border: 1px solid #dce5ec; border-radius: 12px; padding: 16px; } .q { font-weight: 600; } .ans { color: #586879; margin: 8px 0 0; white-space: pre-wrap; }
  .tiles { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; }
  .tile { border: 1px solid #dce5ec; border-radius: 12px; padding: 16px; }
  .tlabel { font-size: 10px; text-transform: uppercase; letter-spacing: .05em; color: #6b7280; }
  .tvalue { font-size: 20px; font-weight: 600; margin: 2px 0 4px; } .tunit { font-size: 11px; color: #6b7280; font-weight: 400; }
  .clip { margin: 12px 0; } .clip video { width: 100%; max-width: 420px; border-radius: 8px; border: 1px solid #e5e7eb; }
  figcaption { font-size: 12px; color: #374151; margin-top: 4px; }
  .toolbar { position: fixed; top: 12px; right: 16px; }
  .toolbar button { font: inherit; padding: 10px 18px; border: 1px solid #007d7a; border-radius: 8px; background: #007d7a; color: white; cursor: pointer; }
  @media (max-width: 640px) { body { margin: 72px auto 24px; padding: 0 16px; } h1 { font-size: 28px; } .cols { flex-direction: column; gap: 12px; } .tiles { grid-template-columns: repeat(2,minmax(0,1fr)); } td,th { padding: 8px 6px; } }
  @media print { .toolbar { display: none; } body { margin: 0; } .clip video { display: none; } .clip::after { content: "▶ clip available in the digital report"; font-size: 11px; color: #6b7280; } }
</style></head><body>
<div class="toolbar"><button onclick="window.print()">Print / Save PDF</button></div>
<h1>Process Session Report</h1>
<div class="sub">${escapeHtml(a.caseName)} · ${new Date().toLocaleString()} · Guardian: ${escapeHtml(a.monitor.display)} · Assistant: ${escapeHtml(a.model.display)}</div>
<div class="sub">${currentGuardian.length} Guardian checks · ${alerts.length} alert(s) · ${watches.length} watch(es) · ${qaPairs.length} Q&amp;A exchange(s)</div>

<h2>Workflow evidence</h2><table><tr><th>Step</th><th>Progress</th><th>Confirmation</th><th>Evidence</th></tr>${a.stages.map((s) => `<tr><td>${escapeHtml(s.name)}</td><td>${s.progress || 0}%</td><td>${escapeHtml(s.confirmation || "Unconfirmed")}</td><td>${li(s.criteria.map((c) => `${c.label}: ${c.status}${c.evidence ? ` — ${c.evidence}` : ""}`))}</td></tr>`).join("")}</table>
<h2>1 · Guardian — Process Observer</h2>
<p>${escapeHtml(ai?.overall ?? "(Recorded debrief has not been prepared)")}</p>
<div class="cols">
  <div class="col"><h3>1.1 What to improve</h3><ul class="improve">${li(ai?.to_improve ?? [])}</ul></div>
  <div class="col"><h3>1.2 Recorded confirmations</h3><ul class="good">${li(ai?.done_properly ?? [])}</ul></div>
</div>
${alerts.length ? `<h3>Alert timeline</h3><table><tr><th>Time</th><th>Video</th><th>Alert</th></tr>${alertRows}</table>` : ""}

<h2>2 · Process Q&amp;A</h2>
<p class="muted">Session-wide conversation may include earlier sources. It is not part of the current-source analysis PDF or offline HTML.</p>
${ai?.qa_summary ? `<p>${escapeHtml(ai.qa_summary)}</p>` : ""}
${qaHtml || '<p class="muted">No questions were asked during this session.</p>'}

<h2>3 · Incident video shorts</h2>
${clipsHtml}

<h2>4 · Metrics overview</h2>
<p class="muted">Session-wide telemetry can include earlier sources. These values are not part of the source-scoped analysis PDF or offline HTML report.</p>
${(a.liveMetrics ?? []).length ? `<div class="tiles">${metricCards}</div>` : '<p class="muted">No telemetry metrics were recorded.</p>'}

<p class="sub" style="margin-top:32px">Generated by Process Guide · recorded visual evidence and operator confirmations. AI observations require review.</p>
</body></html>`;
  };

  const completedSteps = a.stages.filter((step) => step.complete).length;
  const manualSteps = a.stages.filter(
    (step) => step.complete && step.confirmation === "manual",
  ).length;
  const aiSteps = a.stages.filter(
    (step) => step.complete && step.confirmation === "AI",
  ).length;
  const openIssues =
    review?.exceptions.filter((issue) => issue.status !== "resolved") ?? [];
  const resolvedIssues =
    review?.exceptions.filter((issue) => issue.status === "resolved") ?? [];
  const displayedIssues = showResolved
    ? [...openIssues, ...resolvedIssues]
    : openIssues;
  const preparedChecks =
    review?.checks.filter((check) => check.checked).length ?? 0;
  const sourceLabel =
    a.sourceKind === "camera"
      ? "Live camera"
      : a.sourceKind === "screen"
        ? "Screen capture"
        : a.sourceKind === "video"
          ? "Uploaded video"
          : "No source loaded";
  const canExport = !!review && a.sourceReady;
  const reportIdentity =
    a.caseName && !/^untitled guidance session$/i.test(a.caseName.trim())
      ? a.caseName
      : a.workflow?.title || a.sourceName || a.caseName;
  const criterionLabel = (status: string) => status.replace(/_/g, " ");

  const emptyState = (text: string) => (
    <p className="rounded-xl border border-dashed bg-muted/25 px-4 py-5 text-sm leading-relaxed text-muted-foreground">
      {text}
    </p>
  );

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent className="workspace-professional-dialog flex max-h-[90dvh] max-w-5xl flex-col gap-0 overflow-hidden p-4 sm:rounded-2xl sm:p-6">
        <DialogHeader className="shrink-0 space-y-2 border-b pb-4 text-left">
          <p className="text-xs font-medium tracking-wide text-primary">
            Process Guide · Analysis &amp; review
          </p>
          <DialogTitle className="pr-10 text-2xl font-semibold leading-tight tracking-tight">
            Session report
          </DialogTitle>
          <DialogDescription
            className="line-clamp-2 break-words pr-8 text-sm leading-relaxed"
            title={reportIdentity}
          >
            {reportIdentity}
          </DialogDescription>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 pt-1 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1.5">
              <Video className="size-3.5 shrink-0" />
              {sourceLabel}
            </span>
            <span className="inline-flex min-w-0 items-center gap-1.5">
              <FileText className="size-3.5 shrink-0" />
              <span className="line-clamp-1 break-all" title={a.referenceName}>
                {a.referenceName || "Video-only guidance"}
              </span>
            </span>
            {review && <span>Review {review.review_version}</span>}
          </div>
        </DialogHeader>

        <div
          ref={body}
          className="min-h-0 flex-1 overflow-y-auto py-4 pr-1 scrollbar-thin [overflow-wrap:anywhere] sm:py-5"
        >
          <nav
            aria-label="Report sections"
            className="mb-4 flex gap-1 overflow-x-auto pb-1"
          >
            {(
              [
                ["export", "Export"],
                ["workflow", "Workflow"],
                ["evidence", "Evidence"],
                ["guardian", "Guardian clips"],
                ["issues", "Issues"],
                ["preparation", "Preparation"],
                ["debrief", "Debrief"],
                ["conversation", "Conversation"],
              ] as [ReportSection, string][]
            ).map(([section, label]) => (
              <Button
                key={section}
                size="sm"
                variant="ghost"
                className="min-h-11 shrink-0 px-3 text-xs"
                onClick={() => navigate(section)}
              >
                {label}
              </Button>
            ))}
          </nav>
          <div
            className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-4 sm:gap-3"
            aria-label="Report overview"
          >
            {[
              {
                value: a.stages.length
                  ? `${completedSteps}/${a.stages.length}`
                  : "—",
                label: "Steps confirmed",
                detail: a.stages.length
                  ? `${aiSteps} AI · ${manualSteps} manual`
                  : "No steps extracted",
              },
              {
                value: review ? openIssues.length : "—",
                label: "Open issues",
                detail: review ? "Awaiting resolution" : "Review unavailable",
              },
              {
                value: review?.events.length ?? "—",
                label: "Evidence records",
                detail: "Retained timeline entries",
              },
              {
                value: review?.checks.length
                  ? `${preparedChecks}/${review.checks.length}`
                  : "—",
                label: "Preparation checks",
                detail: review?.checks.length
                  ? "Operator records"
                  : "No checks derived",
              },
            ].map((item) => (
              <div
                key={item.label}
                className="min-w-0 rounded-xl border bg-card p-2.5 sm:p-4"
              >
                <p className="text-xs font-medium text-muted-foreground">
                  {item.label}
                </p>
                <p className="mt-1 text-xl font-semibold tracking-tight tabular-nums sm:mt-2 sm:text-2xl">
                  {item.value}
                </p>
                <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground sm:mt-1.5 sm:text-xs">
                  {item.detail}
                </p>
              </div>
            ))}
          </div>

          <ReportOverview
            stages={a.stages}
            review={review}
            onNavigate={navigate}
          />

          <section
            className="mb-6 rounded-xl border border-primary/20 bg-card p-4 sm:p-5"
            aria-label="Shareable analysis report"
            data-report-section="export"
            tabIndex={-1}
          >
            <div className="flex items-start gap-3">
              <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                <FileText className="size-5" />
              </div>
              <div className="min-w-0">
                <h3 className="text-base font-semibold tracking-tight">
                  Export this report
                </h3>
                <p className="mt-1 max-w-2xl text-sm leading-relaxed text-muted-foreground">
                  Workflow progress, captured evidence, review decisions and
                  preparation checks in one document.
                </p>
              </div>
            </div>
            <div className="mt-4 grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
              {prepared && (
                <>
                  <Button
                    size="sm"
                    className="col-span-2 min-h-11 min-w-0 gap-2 text-xs sm:text-sm"
                    onClick={() => {
                      downloadReport(prepared.file);
                      setExportNotice("PDF downloaded.");
                    }}
                  >
                    <Download className="size-4" />
                    Download PDF
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="min-h-11 min-w-0 gap-1.5 whitespace-normal px-2 text-xs sm:gap-2 sm:whitespace-nowrap sm:px-3 sm:text-sm"
                    disabled={shareBusy}
                    onClick={() => void sharePrepared()}
                  >
                    {shareBusy ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : (
                      <Share2 className="size-4" />
                    )}
                    {canShareReport(prepared.file)
                      ? "Share PDF"
                      : "Save to share"}
                  </Button>
                </>
              )}
              <Button
                size="sm"
                variant={prepared ? "outline" : "default"}
                className={`${prepared ? "" : "col-span-2"} min-h-11 min-w-0 gap-1.5 whitespace-normal px-2 text-xs sm:gap-2 sm:whitespace-nowrap sm:px-3 sm:text-sm`}
                disabled={!!exportBusy || !canExport}
                onClick={() => void prepareReport("pdf")}
              >
                {exportBusy === "pdf" ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : prepared ? (
                  <RefreshCw className="size-4" />
                ) : (
                  <FileText className="size-4" />
                )}
                {prepared ? "Refresh PDF" : "Prepare PDF"}
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="col-span-2 min-h-11 min-w-0 gap-2 text-xs sm:text-sm"
                disabled={!!exportBusy || !canExport}
                onClick={() => void prepareReport("html")}
              >
                {exportBusy === "html" ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Download className="size-4" />
                )}
                Offline HTML
              </Button>
            </div>
            {prepared && (
              <div
                role="status"
                className="mt-4 flex items-start gap-2 rounded-lg border border-primary/15 bg-primary/5 p-3 text-xs leading-relaxed"
              >
                <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-primary" />
                <div>
                  <span className="font-medium">PDF ready</span> ·{" "}
                  {(prepared.file.size / 1024).toFixed(0)} KB · Review{" "}
                  {prepared.version}
                  {review && review.review_version !== prepared.version && (
                    <p className="mt-1 text-warning">
                      New activity has been recorded. Refresh the PDF to include
                      it.
                    </p>
                  )}
                </div>
              </div>
            )}
            {exportError && (
              <p
                role="alert"
                className="mt-3 rounded-lg border border-destructive/20 bg-destructive/5 p-3 text-sm leading-relaxed text-destructive"
              >
                {exportError}
              </p>
            )}
            {exportNotice && (
              <p
                role="status"
                className="mt-3 text-sm leading-relaxed text-primary"
              >
                {exportNotice}
              </p>
            )}
            {!canExport && (
              <p className="mt-3 text-xs text-muted-foreground">
                Load a source to prepare its report.
              </p>
            )}
            <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
              PDF is ready for phones, PCs and supported share menus. Offline
              HTML preserves the report and its images without a connection.
              Download a file to attach it in a messaging app.
            </p>
            <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
              PDF and Offline HTML contain current-source review records.
              Session chat, telemetry, clips and the optional debrief are
              included in Detailed session print.
            </p>
          </section>

          {(a.sourceName ||
            review?.job?.work_order ||
            review?.job?.asset ||
            review?.job?.operator) && (
            <dl className="mb-6 grid grid-cols-1 gap-x-6 gap-y-3 rounded-xl border bg-muted/25 p-4 text-sm sm:grid-cols-2">
              {[
                ["Source", a.sourceName],
                ["Work order", review?.job?.work_order],
                ["Asset / workstation", review?.job?.asset],
                ["Operator", review?.job?.operator],
              ]
                .filter(([, value]) => value)
                .map(([label, value]) => (
                  <div key={label} className="min-w-0">
                    <dt className="text-xs text-muted-foreground">{label}</dt>
                    <dd className="mt-1 break-words font-medium">{value}</dd>
                  </div>
                ))}
            </dl>
          )}

          <section
            className="mb-7"
            aria-label="Operator preparation"
            data-report-section="preparation"
            tabIndex={-1}
          >
            <SectionTitle
              icon={<CheckCircle2 className="size-4" />}
              title="Operator preparation"
              description="Manual preparation records and the guidance reference behind this workflow."
            />
            {a.operatorGoals && (
              <div className="mb-3 rounded-xl border border-primary/20 bg-primary/5 p-4">
                <h4 className="text-sm font-semibold">Operator focus</h4>
                <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed">
                  {a.operatorGoals}
                </p>
              </div>
            )}
            {review?.checks.length ? (
              <ul className="divide-y rounded-xl border bg-card px-4">
                {review.checks.map((check) => (
                  <li key={check.id} className="flex items-start gap-3 py-3">
                    <CheckCircle2
                      className={`mt-0.5 size-4 shrink-0 ${check.checked ? "text-primary" : "text-muted-foreground/50"}`}
                    />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm leading-relaxed">{check.label}</p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {check.checked
                          ? `Checked${check.checked_by ? ` by ${check.checked_by}` : " by the operator"}${check.checked_at ? ` · ${new Date(check.checked_at).toLocaleString()}` : ""}`
                          : "Not checked"}{" "}
                        · {check.kind}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              emptyState(
                "No preparation checks were derived from this workflow.",
              )
            )}
            {!!a.workflow?.principles.length && (
              <details className="mt-3 rounded-xl border bg-card p-4">
                <summary className="flex min-h-11 cursor-pointer items-center text-sm font-semibold">
                  Guidance principles ({a.workflow.principles.length})
                </summary>
                <ul className="mt-2 list-disc space-y-2 pl-5 text-sm leading-relaxed text-muted-foreground">
                  {a.workflow.principles.map((principle, index) => (
                    <li key={index}>{principle}</li>
                  ))}
                </ul>
              </details>
            )}
            {!!a.workflow?.warnings.length && (
              <div className="mt-3 rounded-xl border border-warning/25 bg-warning/5 p-4">
                <h4 className="text-sm font-semibold">Reference notes</h4>
                <ul className="mt-2 list-disc space-y-2 pl-5 text-sm leading-relaxed">
                  {a.workflow.warnings.map((warning, index) => (
                    <li key={index}>{warning}</li>
                  ))}
                </ul>
              </div>
            )}
            {a.workflow?.source === "inferred" && (
              <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
                This workflow was inferred from visual samples. Review its steps
                and criteria before treating it as a guidance reference.
              </p>
            )}
          </section>

          <section
            className="mb-7"
            aria-label="Workflow evidence"
            data-report-section="workflow"
            tabIndex={-1}
          >
            <SectionTitle
              icon={<CheckCircle2 className="size-4" />}
              title="Workflow evidence"
              description="Criterion observations and step confirmations are recorded separately."
            />
            <div className="space-y-3">
              {a.stages.map((step, index) => {
                const progress = Math.max(0, Math.min(100, step.progress || 0));
                return (
                  <details
                    key={step.id}
                    open={a.stages.length <= 3 || step.id === a.currentStageId}
                    className="group overflow-hidden rounded-xl border bg-card"
                  >
                    <summary className="grid cursor-pointer list-none grid-cols-[2rem_minmax(0,1fr)_1rem] items-center gap-x-3 gap-y-2 p-4 marker:hidden sm:grid-cols-[2rem_minmax(0,1fr)_auto_1rem] [&::-webkit-details-marker]:hidden">
                      <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted text-xs font-semibold text-muted-foreground tabular-nums">
                        {String(index + 1).padStart(2, "0")}
                      </span>
                      <div className="col-start-2 row-start-1 min-w-0">
                        <h4 className="break-words text-sm font-semibold">
                          {step.name}
                        </h4>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {step.criteria.length}{" "}
                          {step.criteria.length === 1
                            ? "criterion"
                            : "criteria"}{" "}
                          · {progress}% progress
                        </p>
                      </div>
                      <Badge
                        variant="outline"
                        className={`col-start-2 row-start-2 justify-self-start text-xs sm:col-start-3 sm:row-start-1 ${step.complete ? "border-primary/25 bg-primary/5 text-primary" : "text-muted-foreground"}`}
                      >
                        {step.complete
                          ? step.confirmation === "manual"
                            ? "Manual confirmation"
                            : step.confirmation === "AI"
                              ? "AI confirmation"
                              : "Confirmed"
                          : "Unfinished"}
                      </Badge>
                      <ChevronDown className="col-start-3 row-start-1 size-4 text-muted-foreground transition-transform group-open:rotate-180 sm:col-start-4" />
                    </summary>
                    <div className="border-t px-4 pb-4 pt-3">
                      {step.objective && (
                        <p className="mb-3 text-sm leading-relaxed text-muted-foreground">
                          {step.objective}
                        </p>
                      )}
                      {step.actions?.length > 0 && (
                        <details className="mb-3 rounded-lg bg-muted/25 px-3">
                          <summary className="flex min-h-11 cursor-pointer items-center text-xs font-medium">
                            Planned actions ({step.actions.length})
                          </summary>
                          <ol className="list-decimal space-y-1.5 pb-3 pl-5 text-sm leading-relaxed text-muted-foreground">
                            {step.actions.map((action, index) => (
                              <li key={index}>{action}</li>
                            ))}
                          </ol>
                          {!!step.expectedInstruments?.length && (
                            <p className="pb-3 text-xs leading-relaxed text-muted-foreground">
                              Tools: {step.expectedInstruments.join(", ")}
                            </p>
                          )}
                        </details>
                      )}
                      <div
                        className="mb-3 h-1.5 overflow-hidden rounded-full bg-muted"
                        role="progressbar"
                        aria-label={`${step.name} criterion progress`}
                        aria-valuenow={progress}
                        aria-valuemin={0}
                        aria-valuemax={100}
                      >
                        <div
                          className="h-full rounded-full bg-primary/70"
                          style={{ width: `${progress}%` }}
                        />
                      </div>
                      <ul className="divide-y">
                        {step.criteria.map((criterion) => (
                          <li
                            key={criterion.key}
                            className="py-3 first:pt-0 last:pb-0"
                          >
                            <div className="flex flex-wrap items-start justify-between gap-2">
                              <p className="min-w-0 flex-1 text-sm leading-relaxed">
                                {criterion.label}
                              </p>
                              <span className="rounded-md bg-muted px-2 py-1 text-xs capitalize text-muted-foreground">
                                {criterionLabel(criterion.status)}
                              </span>
                            </div>
                            {criterion.evidence && (
                              <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
                                {criterion.evidence}
                              </p>
                            )}
                          </li>
                        ))}
                      </ul>
                      {!step.criteria.length && (
                        <p className="text-sm text-muted-foreground">
                          No criteria recorded for this step.
                        </p>
                      )}
                    </div>
                  </details>
                );
              })}
            </div>
            {!a.stages.length &&
              emptyState(
                "No workflow steps are available yet. Load instructions or begin guiding a source to record its workflow.",
              )}
          </section>

          <section
            className="mb-7"
            aria-label="Recorded evidence"
            data-report-section="evidence"
            tabIndex={-1}
          >
            <SectionTitle
              icon={<Video className="size-4" />}
              title="Recorded evidence"
              description="Captured moments and their observation origin, retained for the current source."
            />
            <ReportEvidence review={review} apiBase={a.apiBase} />
          </section>

          <section
            className="mb-7"
            aria-label="Guardian clip library"
            data-report-section="guardian"
            tabIndex={-1}
          >
            <SectionTitle
              icon={<ShieldAlert className="size-4" />}
              title="Guardian clip library"
              description="Watch observations, alerts and their recorded review decisions."
            />
            <ReportGuardianLibrary
              review={review}
              apiBase={a.apiBase}
              videoAvailable={serverSideVideo && canExport}
            />
          </section>

          <section
            className="mb-7"
            aria-label="Open review issues"
            data-report-section="issues"
            tabIndex={-1}
          >
            <SectionTitle
              icon={<AlertTriangle className="size-4" />}
              title="Review decisions"
              description={`${openIssues.length} open · ${resolvedIssues.length} resolved. Resolving an issue does not confirm workflow criteria.`}
            />
            {resolvedIssues.length > 0 && (
              <label className="mb-3 flex min-h-11 cursor-pointer items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  className="size-4 accent-primary"
                  checked={showResolved}
                  onChange={(event) => setShowResolved(event.target.checked)}
                />
                Include resolved report issues
              </label>
            )}
            <div className="space-y-3">
              {displayedIssues.map((issue) => (
                <div key={issue.id} className="rounded-xl border bg-card p-4">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <h4 className="min-w-0 flex-1 text-sm font-semibold">
                      {issue.title}
                    </h4>
                    <Badge variant="outline" className="text-xs capitalize">
                      {issue.status}
                    </Badge>
                  </div>
                  {issue.description && (
                    <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                      {issue.description}
                    </p>
                  )}
                  {issue.old_reference && (
                    <p className="mt-2 text-xs text-warning">
                      Recorded against earlier instructions
                    </p>
                  )}
                  <p className="mt-2 text-xs text-muted-foreground">
                    {issue.provenance === "ai"
                      ? "AI concern"
                      : issue.provenance === "system"
                        ? "System check"
                        : "Operator record"}
                  </p>
                  <details className="mt-2 text-sm">
                    <summary className="flex min-h-11 cursor-pointer items-center text-primary">
                      Decision history ({issue.history.length})
                    </summary>
                    <ol className="space-y-3 border-l-2 border-primary/20 pl-3">
                      {issue.history.map((item, index) => (
                        <li key={index}>
                          <p className="text-xs font-medium capitalize">
                            {item.status} · {item.operator || "Operator"} ·{" "}
                            {new Date(item.at).toLocaleString()}
                          </p>
                          <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                            {item.note || "No note recorded"}
                          </p>
                        </li>
                      ))}
                    </ol>
                    {!!issue.history_omitted && (
                      <p className="mt-2 text-xs text-muted-foreground">
                        {issue.history_omitted} older decisions omitted by the
                        history retention limit.
                      </p>
                    )}
                  </details>
                </div>
              ))}
            </div>
            {!displayedIssues.length &&
              emptyState(
                resolvedIssues.length
                  ? "No open issues remain in this snapshot. Include resolved issues to inspect their decision history."
                  : "No issues were recorded. This does not establish that the process was free of issues.",
              )}
          </section>

          <section
            className="mb-7"
            aria-label="Guardian debrief"
            data-report-section="debrief"
            tabIndex={-1}
          >
            <SectionTitle
              icon={<ShieldAlert className="size-4" />}
              title="Guardian debrief"
              description="Recorded-data summary; preparing it does not run new AI analysis. Guardian checks use the current source. Session chat may include earlier sources."
              action={
                <Button
                  size="sm"
                  variant="outline"
                  className="min-h-11 gap-2"
                  onClick={() => void genSummary()}
                  disabled={aiBusy || !canExport}
                >
                  <RefreshCw
                    className={`size-4 ${aiBusy ? "animate-spin" : ""}`}
                  />
                  {ai ? "Refresh debrief" : "Prepare debrief"}
                </Button>
              }
            />
            {aiError && (
              <p
                role="alert"
                className="mb-3 rounded-lg border border-destructive/20 bg-destructive/5 p-3 text-sm leading-relaxed text-destructive"
              >
                {aiError}
              </p>
            )}
            <div className="mb-3 flex flex-wrap gap-2">
              <Badge variant="outline" className="text-xs">
                {currentGuardian.length} checks
              </Badge>
              <Badge
                variant="outline"
                className={`text-xs ${alerts.length ? "border-destructive/25 text-destructive" : "text-muted-foreground"}`}
              >
                {alerts.length} alerts
              </Badge>
              <Badge
                variant="outline"
                className={`text-xs ${watches.length ? "border-warning/25 text-warning" : "text-muted-foreground"}`}
              >
                {watches.length} watches
              </Badge>
            </div>
            {aiBusy && !ai ? (
              <div
                role="status"
                className="flex items-center gap-2 rounded-xl border bg-muted/25 p-4 text-sm text-muted-foreground"
              >
                <Loader2 className="size-4 animate-spin" />
                Preparing the session summary…
              </div>
            ) : ai ? (
              <>
                <p className="rounded-xl border bg-card p-4 text-sm leading-relaxed">
                  {ai.overall}
                </p>
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  <div className="rounded-xl border border-warning/20 bg-warning/5 p-4">
                    <h4 className="mb-3 text-sm font-semibold">
                      What to improve
                    </h4>
                    <ul className="space-y-2 text-sm leading-relaxed">
                      {ai.to_improve.map((item, index) => (
                        <li
                          key={index}
                          className="border-l-2 border-warning/40 pl-3"
                        >
                          {item}
                        </li>
                      ))}
                    </ul>
                    {!ai.to_improve.length && (
                      <p className="text-sm text-muted-foreground">
                        No improvement notes returned in this debrief.
                      </p>
                    )}
                  </div>
                  <div className="rounded-xl border border-primary/20 bg-primary/5 p-4">
                    <h4 className="mb-3 text-sm font-semibold">
                      Recorded confirmations
                    </h4>
                    <ul className="space-y-2 text-sm leading-relaxed">
                      {ai.done_properly.map((item, index) => (
                        <li
                          key={index}
                          className="border-l-2 border-primary/40 pl-3"
                        >
                          {item}
                        </li>
                      ))}
                    </ul>
                    {!ai.done_properly.length && (
                      <p className="text-sm text-muted-foreground">
                        No step confirmations recorded in this debrief.
                      </p>
                    )}
                  </div>
                </div>
              </>
            ) : (
              emptyState(
                "Prepare a debrief to summarize recorded Guardian checks and session chat. PDF and Offline HTML are available without a debrief.",
              )
            )}
            {alerts.length > 0 && (
              <div className="mt-4 space-y-2">
                {alerts.map((entry) => (
                  <div
                    key={entry.id}
                    className="rounded-xl border border-destructive/20 bg-destructive/5 p-4"
                  >
                    <div className="mb-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                      <ShieldAlert className="size-4 text-destructive" />
                      <span>{fmtClock(entry.ts)}</span>
                      {typeof entry.videoS === "number" && (
                        <span className="font-mono">
                          Video {fmtVideo(entry.videoS)}
                        </span>
                      )}
                    </div>
                    <p className="text-sm leading-relaxed">{entry.text}</p>
                  </div>
                ))}
              </div>
            )}
            <p className="mt-3 text-xs text-muted-foreground">
              Guardian: {a.monitor.display} · Assistant: {a.model.display}
            </p>
          </section>

          <section
            className="mb-7"
            aria-label="Process Q&A"
            data-report-section="conversation"
            tabIndex={-1}
          >
            <SectionTitle
              icon={<MessageSquare className="size-4" />}
              title="Process Q&A"
              description={`${qaPairs.length} completed exchanges in this session. Chat can include earlier sources; exported analysis uses the current source’s review records.`}
            />
            {ai?.qa_summary && (
              <p className="mb-3 text-sm leading-relaxed">{ai.qa_summary}</p>
            )}
            {qaPairs.length ? (
              <div className="space-y-3">
                {qaPairs.map((pair, index) => (
                  <details
                    key={index}
                    open={qaPairs.length <= 2}
                    className="rounded-xl border bg-card"
                  >
                    <summary className="cursor-pointer p-4 text-sm font-medium leading-relaxed">
                      <span className="mr-2 text-xs font-normal text-muted-foreground">
                        {fmtClock(pair.ts)}
                      </span>
                      {pair.q}
                    </summary>
                    <p className="whitespace-pre-wrap border-t px-4 py-3 text-sm leading-relaxed text-muted-foreground">
                      {pair.a}
                    </p>
                  </details>
                ))}
              </div>
            ) : (
              emptyState("No questions were asked during this session.")
            )}
          </section>

          {!guardianFindings(review).length && clipEntries.length > 0 && (
            <section className="mb-7" aria-label="Incident video shorts">
              <SectionTitle
                icon={<Video className="size-4" />}
                title="Incident video shorts"
                description="Matching-source clips around recorded Guardian alerts."
              />
              {serverSideVideo && clipEntries.length ? (
                !showClips ? (
                  <div className="rounded-xl border bg-card p-4">
                    <p className="mb-3 text-sm leading-relaxed text-muted-foreground">
                      {clipEntries.length} alert clips available. Load them when
                      needed; the report opens without generating video clips.
                    </p>
                    <Button
                      variant="outline"
                      size="sm"
                      className="min-h-11"
                      onClick={() => setShowClips(true)}
                    >
                      Load alert clips
                    </Button>
                  </div>
                ) : (
                  <div className="grid gap-4 sm:grid-cols-2">
                    {clipEntries.map((entry) => (
                      <figure
                        key={entry.id}
                        className="overflow-hidden rounded-xl border bg-card"
                      >
                        <video
                          controls
                          preload="none"
                          src={clipUrl(entry)}
                          className="aspect-video w-full bg-black"
                        />
                        <figcaption className="p-4 text-sm leading-relaxed">
                          <span className="mb-2 block font-mono text-xs text-muted-foreground">
                            Video{" "}
                            {typeof entry.videoS === "number"
                              ? fmtVideo(entry.videoS)
                              : "—"}
                          </span>
                          {entry.text}
                        </figcaption>
                      </figure>
                    ))}
                  </div>
                )
              ) : (
                emptyState(
                  alerts.length
                    ? "Video shorts need an uploaded video on the backend."
                    : "No alerts were recorded. No clips are available.",
                )
              )}
            </section>
          )}

          <section aria-label="Metrics overview">
            <SectionTitle
              icon={<Activity className="size-4" />}
              title="Recorded telemetry"
              description="Session-wide values can include earlier sources. These are not evidence of the current source and are excluded from its analysis PDF and Offline HTML."
            />
            {(a.liveMetrics ?? []).length ? (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                {a.liveMetrics!.map((metric) => (
                  <div
                    key={metric.key}
                    className="rounded-xl border bg-card p-4"
                  >
                    <p className="break-words text-xs text-muted-foreground">
                      {metric.label}
                    </p>
                    <div className="mt-2 flex flex-wrap items-baseline gap-1.5">
                      <span className="text-2xl font-semibold tracking-tight tabular-nums">
                        {metric.value}
                      </span>
                      {metric.unit && (
                        <span className="text-xs text-muted-foreground">
                          {metric.unit}
                        </span>
                      )}
                    </div>
                    {metric.trend && metric.trend.length > 1 && (
                      <svg
                        width="120"
                        height="26"
                        viewBox="0 0 120 26"
                        className="mt-3 max-w-full"
                        aria-label={`${metric.label} recorded trend`}
                        role="img"
                      >
                        <polyline
                          points={sparkPoints(metric.trend)}
                          fill="none"
                          stroke={
                            metric.tone === "warning"
                              ? "hsl(var(--warning))"
                              : "hsl(var(--primary))"
                          }
                          strokeWidth="2"
                          strokeLinejoin="round"
                          strokeLinecap="round"
                        />
                      </svg>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              emptyState("No telemetry metrics recorded.")
            )}
          </section>
        </div>

        <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-t pt-3">
          <p className="max-w-xl text-xs leading-relaxed text-muted-foreground">
            Recorded samples · AI and manual confirmations labeled.
          </p>
          <Button
            size="sm"
            variant="ghost"
            className="min-h-11 shrink-0 gap-2 text-xs"
            onClick={openPrintable}
          >
            <Printer className="size-4" />
            Detailed session print
          </Button>
          {printError && (
            <p
              role="alert"
              className="basis-full rounded-lg border border-destructive/20 bg-destructive/5 p-3 text-xs leading-relaxed text-destructive"
            >
              {printError}
            </p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
