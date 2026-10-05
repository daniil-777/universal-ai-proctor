import { ArrowUpRight, ListChecks } from "lucide-react";
import type { Stage } from "@/lib/types";
import type { ReviewResponse } from "@/lib/reviewTypes";

export type ReportSection =
  | "guardian"
  | "export"
  | "workflow"
  | "evidence"
  | "issues"
  | "preparation"
  | "debrief"
  | "conversation";

export function ReportOverview({
  stages,
  review,
  onNavigate,
}: {
  stages: Stage[];
  review: ReviewResponse | null;
  onNavigate: (section: ReportSection) => void;
}) {
  const complete = stages.filter((step) => step.complete).length;
  const groups = [
    {
      label: "AI",
      count: stages.filter(
        (step) => step.complete && step.confirmation === "AI",
      ).length,
      color: "bg-primary",
    },
    {
      label: "Manual",
      count: stages.filter(
        (step) => step.complete && step.confirmation === "manual",
      ).length,
      color: "bg-sky-600",
    },
    {
      label: "Other confirmation",
      count: stages.filter((step) => step.complete && !step.confirmation)
        .length,
      color: "bg-violet-500",
    },
    {
      label: "Unfinished",
      count: stages.length - complete,
      color: "bg-muted-foreground/25",
    },
  ];
  const criteria = stages.flatMap((step) =>
    step.criteria.map((criterion) => ({ ...criterion, stepName: step.name })),
  );
  const rank = { not_met: 0, partial: 1, unknown: 2, met: 3 };
  const unresolved = criteria
    .filter((criterion) => criterion.status !== "met")
    .sort((a, b) => rank[a.status] - rank[b.status]);
  const issues =
    review?.exceptions.filter((issue) => issue.status !== "resolved") ?? [];
  const unchecked = review?.checks.filter((check) => !check.checked) ?? [];
  const priorities: {
    section: ReportSection;
    label: string;
    count: number;
    title: string;
    detail: string;
  }[] = [];
  if (issues.length)
    priorities.push({
      section: "issues",
      label: "Open issues",
      count: issues.length,
      title: issues[0].title,
      detail: "Review the recorded concern and decision history.",
    });
  if (unresolved.length)
    priorities.push({
      section: "workflow",
      label: "Criteria need review",
      count: unresolved.length,
      title: unresolved[0].label,
      detail: `${unresolved[0].stepName} · ${unresolved[0].status.replace(/_/g, " ")}`,
    });
  if (unchecked.length)
    priorities.push({
      section: "preparation",
      label: "Preparation remaining",
      count: unchecked.length,
      title: unchecked[0].label,
      detail: "Operator confirmation is still outstanding.",
    });
  return (
    <section
      className="mb-5 overflow-hidden rounded-xl border bg-card"
      aria-label="Review priorities"
    >
      <div className="border-b p-4 sm:p-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="flex items-center gap-2 text-base font-semibold tracking-tight">
              <ListChecks className="size-4 text-primary" />
              Review priorities
            </h3>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
              Recorded progress and outstanding review work.
            </p>
          </div>
          <span className="shrink-0 text-sm font-semibold tabular-nums">
            {stages.length
              ? `${complete}/${stages.length} steps`
              : "No steps yet"}
          </span>
        </div>
        {stages.length > 0 && (
          <>
            <div
              className="mt-4 flex h-2 overflow-hidden rounded-full bg-muted"
              role="img"
              aria-label={groups
                .map((group) => `${group.label}: ${group.count}`)
                .join(", ")}
            >
              {groups
                .filter((group) => group.count)
                .map((group) => (
                  <span
                    key={group.label}
                    className={group.color}
                    style={{ width: `${(group.count / stages.length) * 100}%` }}
                  />
                ))}
            </div>
            <ul className="mt-2.5 flex flex-wrap gap-x-4 gap-y-2 text-xs text-muted-foreground">
              {groups
                .filter(
                  (group) =>
                    group.label !== "Other confirmation" || group.count,
                )
                .map((group) => (
                  <li key={group.label} className="flex items-center gap-1.5">
                    <span
                      className={`size-2 rounded-full ${group.color}`}
                      aria-hidden="true"
                    />
                    {group.label}
                    <span className="font-medium text-foreground tabular-nums">
                      {group.count}
                    </span>
                  </li>
                ))}
            </ul>
          </>
        )}
        {criteria.length > 0 && (
          <p
            className="mt-3 text-xs leading-relaxed text-muted-foreground"
            aria-label="Criterion status counts"
          >
            {criteria.filter((c) => c.status === "met").length} met ·{" "}
            {criteria.filter((c) => c.status === "partial").length} partial ·{" "}
            {criteria.filter((c) => c.status === "not_met").length} not met ·{" "}
            {criteria.filter((c) => c.status === "unknown").length} unknown
          </p>
        )}
      </div>
      {priorities.length ? (
        <ul className="divide-y">
          {priorities.map((item) => (
            <li key={item.section}>
              <button
                type="button"
                onClick={() => onNavigate(item.section)}
                className="flex min-h-11 w-full items-start gap-3 p-4 text-left transition-colors hover:bg-muted/40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary sm:px-5"
                aria-label={`Review ${item.label.toLowerCase()}`}
              >
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-2 text-xs font-medium text-muted-foreground">
                    {item.label}
                    <span className="rounded bg-muted px-1.5 py-0.5 text-foreground tabular-nums">
                      {item.count}
                    </span>
                  </p>
                  <p className="mt-1 text-sm font-medium leading-relaxed">
                    {item.title}
                  </p>
                  <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                    {item.detail}
                  </p>
                </div>
                <ArrowUpRight className="mt-1 size-4 shrink-0 text-primary" />
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="p-4 text-sm leading-relaxed text-muted-foreground">
          {!review
            ? "Load a source and its review records to identify follow-up work."
            : !stages.length || !criteria.length
              ? "Workflow criteria are not available. Guide the source or load instructions to begin a recorded review."
              : "No outstanding items in the recorded review. This does not establish that the entire process was observed."}
        </p>
      )}
      {priorities.length > 0 && (
        <p className="border-t px-4 py-2.5 text-xs leading-relaxed text-muted-foreground sm:px-5">
          First item shown per category. All records remain in the sections
          below.
        </p>
      )}
    </section>
  );
}
