import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowDownToLine,
  LogOut,
  UserRound,
  Activity,
  Save,
  Loader2,
  ChevronDown,
} from "lucide-react";
import { useApp } from "@/lib/store";
import { apiFetch } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import "./account.css";

interface User {
  id: string;
  email: string;
  name: string;
  created_at: number;
}
interface Run {
  id: string;
  saved_at: number;
  title: string;
  source_name: string;
  source_kind: string;
  reference_name: string;
  steps: number;
  confirmed_steps: number;
  ai_confirmed_steps: number;
  operator_confirmed_steps: number;
  open_exceptions: number;
  visual_checks: number;
  duration_s: number | null;
}
interface Training {
  summary: {
    sessions: number;
    total_steps: number;
    confirmed_steps: number;
    ai_confirmed_steps: number;
    operator_confirmed_steps: number;
    open_exceptions: number;
    total_visual_checks: number;
  };
  history: Run[];
}
interface SavedReport {
  id: string;
  title: string;
  handoff: {
    source: { name: string };
    reference: { filename: string };
    progress: Array<{
      id: string;
      name: string;
      complete: boolean;
      confirmation: string | null;
      criteria: Array<{ key: string; label: string; status: string }>;
    }>;
    open_exceptions: Array<{ id: string; title: string }>;
    operator_goals: string;
  };
}
export default function AccountDialog() {
  const a = useApp();
  const [open, setOpen] = useState(false);
  const [user, setUser] = useState<User | null>(null);
  const [deployment, setDeployment] = useState("local");
  const [mode, setMode] = useState<"login" | "register">("login");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [training, setTraining] = useState<Training | null>(null);
  const [selected, setSelected] = useState<SavedReport | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [includeImages, setIncludeImages] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [deletePassword, setDeletePassword] = useState("");
  const [deleteConfirmation, setDeleteConfirmation] = useState("");
  const generation = useRef(0);
  const controllers = useRef(new Set<AbortController>());
  const resultDetails = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (!selected) return;
    resultDetails.current?.focus({ preventScroll: true });
    resultDetails.current?.scrollIntoView?.({ block: "nearest" });
  }, [selected]);
  const json = useCallback(
    async <T,>(route: string, body?: object, method = "POST") => {
      const epoch = generation.current;
      const controller = new AbortController();
      controllers.current.add(controller);
      const timer = setTimeout(() => controller.abort(), 15000);
      try {
        const response = await apiFetch(`${a.apiBase}/api/account${route}`, {
          credentials: "include",
          signal: controller.signal,
          ...(body
            ? {
                method,
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(body),
              }
            : {}),
        });
        const data = await response.json();
        if (epoch !== generation.current || controller.signal.aborted)
          throw new DOMException("Context changed", "AbortError");
        if (!response.ok || !data.ok) {
          if (response.status === 401) {
            setUser(null);
            setTraining(null);
            setSelected(null);
          }
          throw new Error(data.error || "Account request failed.");
        }
        return data as T;
      } finally {
        clearTimeout(timer);
        controllers.current.delete(controller);
      }
    },
    [a.apiBase],
  );
  useEffect(() => {
    const active = controllers.current;
    generation.current++;
    setUser(null);
    setTraining(null);
    setSelected(null);
    setPassword("");
    setError("");
    return () => {
      for (const controller of active) controller.abort();
      active.clear();
    };
  }, [a.apiBase, open]);
  const load = useCallback(async () => {
    const result = await json<{ user: User | null; deployment: string }>("/me");
    setUser(result.user);
    setDeployment(result.deployment);
    if (result.user) setTraining(await json<Training>("/training"));
    else {
      setTraining(null);
      setSelected(null);
    }
  }, [json]);
  const run = async (work: () => Promise<unknown>) => {
    const epoch = generation.current;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await work();
    } catch (e) {
      if (epoch === generation.current && (e as Error).name !== "AbortError")
        setError((e as Error).message);
    } finally {
      if (epoch === generation.current) setBusy(false);
    }
  };
  useEffect(() => {
    if (open) {
      const epoch = generation.current;
      setBusy(true);
      void load()
        .catch((e) => {
          if (epoch === generation.current && e.name !== "AbortError")
            setError(e.message);
        })
        .finally(() => {
          if (epoch === generation.current) setBusy(false);
        });
    }
  }, [open, load]);
  const download = async (id: string, kind: "pdf" | "html") => {
    const epoch = generation.current;
    const controller = new AbortController();
    controllers.current.add(controller);
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, 35000);
    const assertCurrent = () => {
      if (epoch !== generation.current || controller.signal.aborted)
        throw new DOMException("Canceled", "AbortError");
    };
    try {
      const response = await apiFetch(
        `${a.apiBase}/api/account/training/${encodeURIComponent(id)}/report.${kind}`,
        { credentials: "include", signal: controller.signal },
      );
      assertCurrent();
      if (!response.ok) {
        const data = await response.json().catch(() => null);
        assertCurrent();
        if (response.status === 401) {
          setUser(null);
          setTraining(null);
          setSelected(null);
        }
        throw new Error(
          typeof data?.error === "string" && data.error.trim()
            ? data.error
            : "Saved report could not be downloaded. Please try again.",
        );
      }
      const blob = await response.blob();
      assertCurrent();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `cueveris-report.${kind}`;
      anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
    } catch (e) {
      if (timedOut && epoch === generation.current)
        throw new Error(
          "Saved report download timed out. Try again or use Offline HTML.",
        );
      throw e;
    } finally {
      clearTimeout(timer);
      controllers.current.delete(controller);
    }
  };
  const resultPanel = selected ? (
    <section
      ref={resultDetails}
      tabIndex={-1}
      className="overflow-hidden rounded-2xl border border-primary/25 bg-card outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
      aria-label={`Saved result details: ${selected.title || "Saved result"}`}
    >
      <div className="flex flex-wrap items-start justify-between gap-3 border-b bg-primary/5 p-4 sm:p-5">
        <div className="min-w-0">
          <p className="mb-1 text-xs font-semibold uppercase tracking-[.14em] text-primary">
            Saved result / Inspection
          </p>
          <h3 className="font-semibold text-base break-words tracking-tight">
            {selected.title || "Saved result"}
          </h3>
          <p className="mt-2 break-words text-xs leading-relaxed text-muted-foreground">
            {selected.handoff.source.name} ·{" "}
            {selected.handoff.reference.filename || "No document"}
          </p>
        </div>
        <Button
          size="sm"
          variant="ghost"
          className="min-h-11 text-xs"
          onClick={() => setSelected(null)}
        >
          Close result
        </Button>
      </div>
      <div className="space-y-4 p-4 sm:p-5">
        {selected.handoff.operator_goals && (
          <div className="rounded-xl border bg-muted/25 p-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Operator wishes
            </p>
            <p className="mt-2 whitespace-pre-wrap break-words text-xs leading-relaxed">
              {selected.handoff.operator_goals}
            </p>
          </div>
        )}
        {selected.handoff.progress.length === 0 && (
          <p className="text-xs text-muted-foreground">
            No workflow steps were recorded in this snapshot.
          </p>
        )}
        <div className="space-y-3">
          {selected.handoff.progress.map((step, index) => (
            <div
              key={step.id}
              className="flex gap-3 rounded-xl border p-3 sm:p-4"
            >
              <span
                className={`grid size-7 shrink-0 place-items-center rounded-lg text-xs font-semibold tabular-nums ${step.complete ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"}`}
                aria-hidden="true"
              >
                {String(index + 1).padStart(2, "0")}
              </span>
              <div className="min-w-0 flex-1 text-xs">
                <p className="font-medium leading-relaxed break-words">
                  {step.name} ·{" "}
                  {step.complete
                    ? `Confirmed (${step.confirmation || "AI"})`
                    : "Unfinished"}
                </p>
                {step.criteria.length > 0 && (
                  <ul className="mt-3 space-y-2 text-muted-foreground">
                    {step.criteria.map((c) => (
                      <li
                        key={c.key}
                        className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1 border-t pt-2"
                      >
                        <span className="min-w-0 flex-1 break-words leading-relaxed">
                          {c.label}
                        </span>
                        <span className="rounded-md bg-muted px-2 py-1 text-xs capitalize">
                          {c.status.replace(/_/g, " ")}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          ))}
        </div>
        {selected.handoff.open_exceptions.length > 0 && (
          <div className="rounded-xl border border-warning/25 bg-warning/5 p-4">
            <p className="text-xs font-semibold text-warning">Open issues</p>
            <ul className="mt-2 list-disc space-y-1 pl-4 text-xs leading-relaxed">
              {selected.handoff.open_exceptions.map((issue) => (
                <li key={issue.id} className="break-words">
                  {issue.title}
                </li>
              ))}
            </ul>
          </div>
        )}
        <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-4">
          <p className="max-w-sm text-xs leading-relaxed text-muted-foreground">
            Delete removes this saved result from your account.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant={deleting === selected.id ? "destructive" : "outline"}
              className={`min-h-11 text-xs ${deleting === selected.id ? "" : "border-destructive/25 text-destructive hover:bg-destructive/5 hover:text-destructive"}`}
              disabled={busy}
              onClick={() =>
                deleting === selected.id
                  ? void run(async () => {
                      await json(`/training/${selected.id}`, {}, "DELETE");
                      setSelected(null);
                      setDeleting(null);
                      await load();
                    })
                  : setDeleting(selected.id)
              }
            >
              {deleting === selected.id
                ? "Confirm delete saved result"
                : "Delete saved result"}
            </Button>
            {deleting === selected.id && (
              <Button
                variant="ghost"
                size="sm"
                className="min-h-11 text-xs"
                onClick={() => setDeleting(null)}
              >
                Cancel
              </Button>
            )}
          </div>
        </div>
      </div>
    </section>
  ) : null;
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          aria-label="Account and training"
          className="h-9 w-9"
        >
          <UserRound className="size-4" />
        </Button>
      </DialogTrigger>
      <DialogContent className="workspace-professional-dialog workspace-account-dialog flex max-w-4xl max-h-[90dvh] flex-col overflow-hidden gap-0 p-0 sm:rounded-2xl">
        <DialogHeader className="shrink-0 border-b bg-card px-4 py-5 text-left sm:px-6">
          <p className="mb-1 text-xs font-semibold uppercase tracking-[.18em] text-primary">
            Cueveris / Personal workspace
          </p>
          <DialogTitle className="pr-10 text-xl font-semibold tracking-tight sm:text-2xl">
            My training workspace
          </DialogTitle>
          <DialogDescription className="max-w-xl text-xs leading-relaxed sm:text-sm">
            Save results, review saved runs and follow your training activity.
          </DialogDescription>
        </DialogHeader>
        <div className="shrink-0 border-b bg-muted/30 px-4 py-3 text-xs leading-relaxed text-muted-foreground sm:px-6">
          <span className="mr-2 font-semibold text-foreground">
            {deployment === "hosted" ? "Server workspace" : "Local workspace"}
          </span>
          {deployment === "hosted"
            ? "Your saved results are held by this app’s server and available when you sign in on another device."
            : "Accounts are saved on this computer’s app server. Online access across devices becomes available when this app is hosted."}
        </div>
        <div className="min-h-0 space-y-5 overflow-y-auto p-4 scrollbar-thin sm:space-y-6 sm:p-6">
          {error && (
            <p
              role="alert"
              className="rounded-xl border border-destructive/20 bg-destructive/5 px-4 py-3 text-sm leading-relaxed text-destructive"
            >
              {error}
            </p>
          )}
          {notice && (
            <p
              role="status"
              className="rounded-xl border border-primary/20 bg-primary/5 px-4 py-3 text-sm text-primary"
            >
              {notice}
            </p>
          )}
          {!user ? (
            <div className="overflow-hidden rounded-2xl border bg-card sm:grid sm:grid-cols-[.85fr_1.15fr]">
              <aside className="account-ink-panel hidden flex-col justify-between p-7 sm:flex">
                <div>
                  <div className="account-emblem mb-6 grid size-11 place-items-center rounded-xl border">
                    <UserRound
                      className="size-5"
                      aria-hidden="true"
                    />
                  </div>
                  <h3 className="max-w-xs text-xl font-semibold leading-tight tracking-tight">
                    A record of your work.
                  </h3>
                  <p className="account-panel-copy mt-3 text-sm leading-relaxed">
                    Keep process results together, revisit recorded evidence and
                    export a report when you need it.
                  </p>
                </div>
                <div className="account-panel-rule account-panel-copy mt-8 space-y-3 border-t pt-5 text-xs">
                  <p>Separate AI observations and operator confirmations.</p>
                  <p>Save evidence images only when you choose.</p>
                </div>
              </aside>
              <form
                className="space-y-5 p-5 sm:p-7"
                onSubmit={(e) => {
                  e.preventDefault();
                  void run(async () => {
                    await json(`/${mode}`, {
                      email,
                      password,
                      ...(mode === "register" ? { name } : {}),
                    });
                    setPassword("");
                    await load();
                  });
                }}
              >
                <div>
                  <h3 className="text-lg font-semibold tracking-tight">
                    {mode === "register"
                      ? "Create your workspace"
                      : "Welcome back"}
                  </h3>
                  <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                    {mode === "register"
                      ? "Use an email and password to keep your saved results."
                      : "Sign in to review your saved process results."}
                  </p>
                </div>
                <div className="grid grid-cols-2 rounded-xl border bg-muted/50 p-1 gap-1">
                  <Button
                    type="button"
                    variant="ghost"
                    className={`min-h-11 rounded-lg text-xs ${mode === "login" ? "bg-card text-foreground shadow-sm" : "text-muted-foreground"}`}
                    aria-pressed={mode === "login"}
                    onClick={() => setMode("login")}
                  >
                    Sign in
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    className={`min-h-11 rounded-lg text-xs ${mode === "register" ? "bg-card text-foreground shadow-sm" : "text-muted-foreground"}`}
                    aria-pressed={mode === "register"}
                    onClick={() => setMode("register")}
                  >
                    Create account
                  </Button>
                </div>
                {mode === "register" && (
                  <label className="block text-xs font-medium">
                    Name
                    <Input
                      className="mt-2 h-11 rounded-lg bg-background/50"
                      placeholder="Your name"
                      autoComplete="name"
                      value={name}
                      maxLength={80}
                      onChange={(e) => setName(e.target.value)}
                      required
                    />
                  </label>
                )}
                <label className="block text-xs font-medium">
                  Email
                  <Input
                    className="mt-2 h-11 rounded-lg bg-background/50"
                    placeholder="you@example.com"
                    type="email"
                    autoComplete="email"
                    value={email}
                    maxLength={254}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                  />
                </label>
                <label className="block text-xs font-medium">
                  Password
                  <Input
                    aria-label="Password"
                    className="mt-2 h-11 rounded-lg bg-background/50"
                    type="password"
                    autoComplete={
                      mode === "register" ? "new-password" : "current-password"
                    }
                    value={password}
                    minLength={mode === "register" ? 12 : undefined}
                    maxLength={128}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                  />
                  {mode === "register" && (
                    <span className="text-xs font-normal text-muted-foreground block mt-2">
                      Use at least 12 characters.
                    </span>
                  )}
                </label>
                <Button disabled={busy} className="min-h-11 w-full rounded-lg">
                  {busy && (
                    <Loader2
                      className="size-4 animate-spin"
                      aria-hidden="true"
                    />
                  )}
                  {busy
                    ? "Please wait…"
                    : mode === "register"
                      ? "Create my account"
                      : "Sign in"}
                </Button>
              </form>
            </div>
          ) : (
            <>
              <div className="account-ink-panel flex flex-wrap items-center justify-between gap-4 rounded-2xl p-5">
                <div className="flex min-w-0 items-center gap-3">
                  <div
                    className="account-emblem grid size-11 shrink-0 place-items-center rounded-xl border text-lg font-semibold"
                    aria-hidden="true"
                  >
                    {(user.name || user.email).trim().charAt(0).toUpperCase()}
                  </div>
                  <div className="min-w-0">
                    <p className="account-panel-copy text-xs uppercase tracking-[.1em]">
                      Your workspace
                    </p>
                    <p className="mt-1 break-words text-base font-semibold">
                      {user.name || user.email}
                    </p>
                    <p className="account-panel-copy mt-1 break-all text-xs">
                      {user.email}
                    </p>
                  </div>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  className="account-panel-action min-h-11 text-xs"
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      await json("/logout", {});
                      await load();
                    })
                  }
                >
                  <LogOut /> Sign out
                </Button>
              </div>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                {[
                  [
                    "Saved runs",
                    training ? training.summary.sessions : "—",
                    "Snapshots you chose to keep",
                  ],
                  [
                    "Confirmed steps",
                    training
                      ? `${training.summary.confirmed_steps}/${training.summary.total_steps}`
                      : "—",
                    "Across your saved runs",
                  ],
                  [
                    "AI confirmations",
                    training ? training.summary.ai_confirmed_steps : "—",
                    "From recorded observations",
                  ],
                  [
                    "Manual confirmations",
                    training ? training.summary.operator_confirmed_steps : "—",
                    "Marked by the operator",
                  ],
                  [
                    "Visual checks",
                    training ? training.summary.total_visual_checks : "—",
                    "Retained observation samples",
                  ],
                  [
                    "Open issues",
                    training ? training.summary.open_exceptions : "—",
                    "Unresolved in saved snapshots",
                  ],
                ].map(([label, value, detail]) => (
                  <div
                    key={label}
                    className="min-w-0 rounded-xl border bg-card p-3 sm:p-4"
                  >
                    <p className="text-xs font-medium text-muted-foreground">
                      {label}
                    </p>
                    <p
                      className={`mt-2 text-2xl font-semibold tracking-tight tabular-nums ${label === "AI confirmations" || label === "Manual confirmations" ? "text-primary" : "text-foreground"}`}
                    >
                      {value}
                    </p>
                    <p className="mt-1 hidden text-xs leading-relaxed text-muted-foreground sm:block">
                      {detail}
                    </p>
                  </div>
                ))}
              </div>
              <p className="text-xs leading-relaxed text-muted-foreground">
                These are workflow records, not skill scores. Confirmations
                reflect the saved evidence and operator decisions.
              </p>
              <section
                className="rounded-2xl border border-primary/20 bg-primary/[.035] p-4 sm:p-5"
                aria-label="Save current run"
              >
                <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold">Keep this run</p>
                    <p className="mt-1 max-w-md text-xs leading-relaxed text-muted-foreground">
                      Saves the current steps, text evidence and decisions.
                      Saving again updates this run.
                    </p>
                  </div>
                  <Button
                    className="min-h-11 shrink-0 rounded-lg text-xs"
                    disabled={busy || !a.sourceReady || !a.review}
                    onClick={() =>
                      void run(async () => {
                        const review = a.review;
                        await json("/training/save", {
                          source_id: a.sourceId,
                          reference_key: review.reference_key,
                          review_version: review.review_version,
                          include_evidence_images: includeImages,
                        });
                        await load();
                        setNotice("Run saved to your account.");
                      })
                    }
                  >
                    <Save /> Save current result
                  </Button>
                </div>
                <label className="mt-3 flex min-h-11 cursor-pointer items-center gap-3 border-t border-primary/10 pt-3 text-xs leading-relaxed text-muted-foreground">
                  <input
                    className="size-4 shrink-0 rounded accent-primary"
                    type="checkbox"
                    checked={includeImages}
                    onChange={(e) => setIncludeImages(e.target.checked)}
                  />
                  Also store captured evidence images in my account
                </label>
                {(!a.sourceReady || !a.review) && (
                  <p className="mt-2 text-xs text-muted-foreground">
                    Load a video or camera source to save a result.
                  </p>
                )}
              </section>
              <div className="flex flex-wrap items-end justify-between gap-2">
                <div>
                  <h3 className="font-semibold text-base tracking-tight">
                    Training activity
                  </h3>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Saved process runs and their recorded progress.
                  </p>
                </div>
                {training && (
                  <p className="text-xs text-muted-foreground">
                    {training.history.length} saved{" "}
                    {training.history.length === 1 ? "run" : "runs"}
                  </p>
                )}
              </div>
              {!training && (
                <div
                  className="flex items-center gap-2 rounded-xl border bg-card p-5 text-sm text-muted-foreground"
                  role="status"
                >
                  {busy && (
                    <Loader2
                      className="size-4 animate-spin"
                      aria-hidden="true"
                    />
                  )}
                  {busy
                    ? "Loading training activity…"
                    : "Training activity could not be loaded. Reopen the workspace to try again."}
                </div>
              )}
              {training?.history.length === 0 && (
                <div className="rounded-2xl border border-dashed bg-card px-5 py-8 text-center">
                  <Activity
                    className="mx-auto mb-3 size-6 text-primary/60"
                    aria-hidden="true"
                  />
                  <p className="text-sm font-semibold">
                    Your first saved run starts here.
                  </p>
                  <p className="mx-auto mt-2 max-w-sm text-xs leading-relaxed text-muted-foreground">
                    Your saved runs will appear here. Load a source and save
                    your first result.
                  </p>
                </div>
              )}
              <div className="space-y-3">
                {training?.history.map((item) => {
                  const progress =
                    item.steps > 0
                      ? Math.min(
                          100,
                          Math.max(
                            0,
                            (item.confirmed_steps / item.steps) * 100,
                          ),
                        )
                      : 0;
                  const status =
                    item.open_exceptions > 0
                      ? "Open issues"
                      : item.steps === 0
                        ? "No steps recorded"
                        : item.confirmed_steps >= item.steps
                          ? "Steps confirmed"
                          : "Steps pending";
                  return (
                    <div key={item.id} className="space-y-3">
                      <article
                        className={`rounded-2xl border bg-card p-4 sm:p-5 ${selected?.id === item.id ? "border-primary/40 ring-1 ring-primary/10" : ""}`}
                      >
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div className="min-w-0">
                            <div className="mb-2 flex flex-wrap items-center gap-2 text-xs">
                              <span className="rounded-md border bg-muted/40 px-2 py-1 font-medium capitalize text-muted-foreground">
                                {item.source_kind}
                              </span>
                              <time
                                className="text-muted-foreground"
                                dateTime={new Date(item.saved_at).toISOString()}
                              >
                                {new Date(item.saved_at).toLocaleString()}
                              </time>
                            </div>
                            <p className="font-semibold text-sm break-words sm:text-base">
                              {item.title || item.source_name || "Guidance run"}
                            </p>
                            <p className="mt-1 break-words text-xs leading-relaxed text-muted-foreground">
                              {item.reference_name ? (
                                <>Document · {item.reference_name}</>
                              ) : (
                                "No guidance document"
                              )}
                            </p>
                          </div>
                          <span
                            className={`max-w-full rounded-full border px-2.5 py-1 text-xs font-medium ${item.open_exceptions > 0 ? "border-warning/25 bg-warning/5 text-warning" : item.steps > 0 && item.confirmed_steps >= item.steps ? "border-primary/20 bg-primary/5 text-primary" : "border-border bg-muted/40 text-muted-foreground"}`}
                          >
                            {status}
                          </span>
                        </div>
                        <div className="mt-4 space-y-2">
                          <div className="flex flex-wrap justify-between gap-2 text-xs">
                            <span className="font-medium">
                              {item.confirmed_steps}/{item.steps} steps
                              confirmed
                            </span>
                            <span className="text-muted-foreground">
                              {item.ai_confirmed_steps} AI ·{" "}
                              {item.operator_confirmed_steps} manual
                            </span>
                          </div>
                          <div
                            role="progressbar"
                            aria-label={`Confirmed steps for ${item.title || item.source_name || "Guidance run"}`}
                            aria-valuemin={0}
                            aria-valuemax={Math.max(1, item.steps)}
                            aria-valuenow={Math.min(
                              item.steps,
                              Math.max(0, item.confirmed_steps),
                            )}
                            aria-valuetext={
                              item.steps
                                ? `${item.confirmed_steps} of ${item.steps} steps confirmed`
                                : "No steps recorded"
                            }
                            className="h-1.5 overflow-hidden rounded-full bg-muted"
                          >
                            <div
                              className="h-full rounded-full bg-primary"
                              style={{ width: `${progress}%` }}
                            />
                          </div>
                        </div>
                        <div className="mt-4 flex flex-col gap-3 border-t pt-3 sm:flex-row sm:items-center sm:justify-between">
                          <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
                            <span>{item.visual_checks} checks</span>
                            <span
                              className={
                                item.open_exceptions > 0 ? "text-warning" : ""
                              }
                            >
                              {item.open_exceptions} open issues
                            </span>
                          </div>
                          <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
                            <Button
                              size="sm"
                              variant="outline"
                              className="col-span-2 min-h-11 rounded-lg px-2 text-xs sm:col-auto sm:px-3"
                              disabled={busy}
                              onClick={() =>
                                void run(async () => {
                                  const data = await json<{
                                    report: SavedReport;
                                  }>(
                                    `/training/${encodeURIComponent(item.id)}`,
                                  );
                                  setSelected(data.report);
                                })
                              }
                            >
                              View result
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="min-h-11 rounded-lg px-2 text-xs"
                              disabled={busy}
                              onClick={() =>
                                void run(() => download(item.id, "pdf"))
                              }
                            >
                              <ArrowDownToLine /> PDF
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="min-h-11 rounded-lg px-2 text-xs"
                              disabled={busy}
                              onClick={() =>
                                void run(() => download(item.id, "html"))
                              }
                            >
                              <ArrowDownToLine /> Offline HTML
                            </Button>
                          </div>
                        </div>
                      </article>
                      {selected?.id === item.id && resultPanel}
                    </div>
                  );
                })}
              </div>
              <details className="group rounded-2xl border bg-card">
                <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-3 p-4 text-xs font-medium [&::-webkit-details-marker]:hidden">
                  <span>Account data and deletion</span>
                  <ChevronDown
                    className="size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180"
                    aria-hidden="true"
                  />
                </summary>
                <div className="border-t px-4 pb-4 pt-4 sm:px-5 sm:pb-5">
                  <p className="max-w-xl text-xs leading-relaxed text-muted-foreground">
                    PDF and HTML exports preserve your results outside this
                    account. Deleting your account permanently removes every
                    saved result and signs out all devices.
                  </p>
                  <form
                    className="mt-5 grid gap-4 sm:grid-cols-2"
                    onSubmit={(e) => {
                      e.preventDefault();
                      void run(async () => {
                        await json(
                          "/me",
                          {
                            password: deletePassword,
                            confirmation: deleteConfirmation,
                          },
                          "DELETE",
                        );
                        setDeletePassword("");
                        setDeleteConfirmation("");
                        await load();
                        setNotice(
                          "Your account and saved results were deleted.",
                        );
                      });
                    }}
                  >
                    <label className="block text-xs font-medium">
                      Confirm your password
                      <Input
                        className="mt-2 h-11 rounded-lg"
                        type="password"
                        autoComplete="current-password"
                        value={deletePassword}
                        onChange={(e) => setDeletePassword(e.target.value)}
                      />
                    </label>
                    <label className="block text-xs font-medium">
                      Type DELETE to confirm
                      <Input
                        className="mt-2 h-11 rounded-lg"
                        value={deleteConfirmation}
                        onChange={(e) => setDeleteConfirmation(e.target.value)}
                      />
                    </label>
                    <Button
                      size="sm"
                      variant="destructive"
                      className="min-h-11 w-full rounded-lg text-xs sm:col-span-2 sm:w-fit"
                      disabled={
                        busy ||
                        deleteConfirmation !== "DELETE" ||
                        deletePassword.length < 12
                      }
                    >
                      Delete my account and results
                    </Button>
                  </form>
                </div>
              </details>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
