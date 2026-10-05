import { z } from "zod";
export const RefRowSchema = z.object({
  step: z.string().max(300),
  objective: z.string().max(5000).default(""),
  instruments: z.string().max(5000).default(""),
  actions: z.string().max(15000).default(""),
  criteria: z.string().max(15000).default(""),
  duration: z.string().max(500).default(""),
});
export type RefRow = z.infer<typeof RefRowSchema>;
const fieldLimits: Record<keyof RefRow, number> = {
  step: 300,
  objective: 5000,
  instruments: 5000,
  actions: 15000,
  criteria: 15000,
  duration: 500,
};
export type CriterionStatus = "unknown" | "partial" | "met" | "not_met";
export interface Criterion {
  key: string;
  label: string;
  status: CriterionStatus;
  evidence?: string;
  confidence?: number;
  confirmedAt?: number;
}
export interface Step {
  id: string;
  index: number;
  name: string;
  description: string;
  objective: string;
  expectedInstruments: string[];
  actions: string[];
  typicalDurationMin: number;
  criteria: Criterion[];
  confidence: number;
  progress: number;
  complete: boolean;
  source: "document" | "inferred";
  confirmation?: "AI" | "manual";
  lastObservedS?: number;
}
export interface Workflow {
  title: string;
  steps: Step[];
  principles: string[];
  source: "document" | "inferred" | "none";
  warnings: string[];
}
const clean = (s: string) =>
  s.replace(/^\s*(?:[•●▪✔✓*+-]|\d+[.)])\s*/u, "").trim();
export const lines = (s: string) =>
  s
    .split(/\n|\s*;\s*/)
    .map(clean)
    .filter(Boolean);
const headings: Record<string, keyof RefRow | "principles"> = {
  objective: "objective",
  goal: "objective",
  aim: "objective",
  purpose: "objective",
  actions: "actions",
  action: "actions",
  procedure: "actions",
  "surgeon action": "actions",
  "key actions": "actions",
  tools: "instruments",
  equipment: "instruments",
  instruments: "instruments",
  "instruments visible": "instruments",
  "expected instruments": "instruments",
  "completion criteria": "criteria",
  criteria: "criteria",
  "complete when": "criteria",
  "mandatory 3 criteria": "criteria",
  "typical duration": "duration",
  duration: "duration",
  principles: "principles",
  principle: "principles",
  safety: "principles",
  warnings: "principles",
  precautions: "principles",
  "safety principles": "principles",
};
const field = (s: string) =>
  headings[
    s
      .toLowerCase()
      .replace(/\s*\([^)]*\)\s*$/, "")
      .replace(/[:—-]\s*$/u, "")
      .trim()
  ];
export function rowsToWorkflow(
  rows: RefRow[],
  title = "Process guidance",
  source: Workflow["source"] = "document",
  principles: string[] = [],
): Workflow {
  const steps = rows
    .filter((r) => r.step.trim())
    .slice(0, 100)
    .map((sourceRow, i): Step => {
      const r = Object.fromEntries(
        Object.entries(sourceRow).map(([key, value]) => [
          key,
          value.slice(0, fieldLimits[key as keyof RefRow]),
        ]),
      ) as RefRow;
      const actions = lines(r.actions || r.objective || r.step);
      const criteria = lines(r.criteria).length
        ? lines(r.criteria)
        : actions.map((a) => `Visible evidence of: ${a}`);
      return {
        id: `S${i + 1}`,
        index: i + 1,
        name: r.step
          .replace(/^(?:step|stage|phase|task)\s*\d+\s*[:.—–-]?\s*/i, "")
          .slice(0, 300),
        description: r.objective || actions[0] || "",
        objective: r.objective,
        expectedInstruments: lines(r.instruments),
        actions,
        typicalDurationMin: Math.max(0, parseFloat(r.duration) || 0),
        criteria: criteria.slice(0, 30).map((label, j) => ({
          key: `S${i + 1}C${j + 1}`,
          label,
          status: "unknown",
        })),
        confidence: 0,
        progress: 0,
        complete: false,
        source: source === "inferred" ? "inferred" : "document",
      };
    });
  const warnings: string[] = [];
  if (
    rows.some((row) =>
      Object.entries(row).some(
        ([key, value]) => value.length > fieldLimits[key as keyof RefRow],
      ),
    )
  )
    warnings.push(
      "Some unusually long sections are shortened in the workflow. Review the full source document or split it into concise steps.",
    );
  if (rows.filter((r) => r.step.trim()).length > 100)
    warnings.push(
      "Only the first 100 steps are shown. Split this document into process sections before using the workflow.",
    );
  if (
    rows.some(
      (r) =>
        lines(r.criteria || r.actions || r.objective || r.step).length > 30,
    )
  )
    warnings.push(
      "Some steps exceed 30 completion criteria. Split these steps; additional criteria are retained in the source document.",
    );
  if (new Set(principles).size > 40)
    warnings.push(
      "Only the first 40 principles are shown. Review the full source document.",
    );
  return {
    title,
    steps,
    principles: [...new Set(principles)].slice(0, 40),
    source,
    warnings: steps.length
      ? warnings
      : [
          "No actionable steps found. Add a numbered process or use AI extraction.",
        ],
  };
}
function splitCsv(text: string, delim: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [],
    value = "",
    quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (c === '"') {
      if (quoted && text[i + 1] === '"') {
        value += '"';
        i++;
      } else quoted = !quoted;
    } else if (!quoted && (c === delim || c === "\n")) {
      row.push(value.trim());
      value = "";
      if (c === "\n") {
        if (row.some(Boolean)) rows.push(row);
        row = [];
      }
    } else if (c !== "\r") value += c;
  }
  if (quoted)
    throw Object.assign(
      new Error("The guidance table contains an unclosed quoted field."),
      { statusCode: 400 },
    );
  row.push(value.trim());
  if (row.some(Boolean)) rows.push(row);
  return rows;
}
export function parseDocument(
  filename: string,
  raw: string,
): { rows: RefRow[]; workflow: Workflow } {
  const text = raw
    .replace(/^\uFEFF/, "")
    .replace(/\r\n/g, "\n")
    .trim();
  if (!text)
    return {
      rows: [],
      workflow: rowsToWorkflow([], "Visual guidance", "none"),
    };
  const title = filename.replace(/\.[^.]+$/, "").replace(/_/g, " ");
  if (/\.(csv|tsv)$/i.test(filename)) {
    const table = splitCsv(text, /\.tsv$/i.test(filename) ? "\t" : ",");
    const headers = table.shift() || [];
    const principles: string[] = [];
    const rows = table
      .map((cells) => {
        const row: RefRow = {
          step: "",
          objective: "",
          instruments: "",
          actions: "",
          criteria: "",
          duration: "",
        };
        headers.forEach((h, i) => {
          const key = field(h) || (/step|stage|title/i.test(h) ? "step" : null);
          if (key === "principles") principles.push(...lines(cells[i] || ""));
          else if (key) row[key] = cells[i] || "";
        });
        return row;
      })
      .filter((r) => r.step);
    return {
      rows,
      workflow: rowsToWorkflow(rows, title, "document", principles),
    };
  }
  const rawLines = text.split("\n");
  const explicit =
    /^\s*(?:#{1,6}\s*)?(?:step|stage|phase|task)\s*(\d+)\s*[:.)—–-]?\s*(.+)$/i;
  const numbered = /^\s*(\d+)[.)]\s+(.+)$/;
  const hasExplicit = rawLines.some((l) => explicit.test(l));
  const isStep = (l: string) =>
    hasExplicit
      ? explicit.test(l)
      : numbered.test(l) ||
        (/^#{1,3}\s+/.test(l) && !field(l.replace(/^#+\s*/, "")));
  const rows: RefRow[] = [];
  const principles: string[] = [];
  let row: RefRow | undefined;
  let target: keyof RefRow | "principles" = "actions";
  let continuedPrinciple: number | undefined;
  for (const rawLine of rawLines) {
    const line = rawLine.trim();
    if (!line) continue;
    if (isStep(line)) {
      continuedPrinciple = undefined;
      row = {
        step: line.replace(/^#+\s*/, "").replace(/^\d+[.)]\s*/, ""),
        objective: "",
        instruments: "",
        actions: "",
        criteria: "",
        duration: "",
      };
      rows.push(row);
      target = "actions";
      continue;
    }
    const plain = line.replace(/^#+\s*/, "");
    const colon = /^([^:]{2,40}):\s*(.*)$/.exec(plain);
    const key = field(colon?.[1] || plain);
    if (key) {
      continuedPrinciple = undefined;
      target = key;
      const inline = colon?.[2];
      if (inline) {
        if (key === "principles") principles.push(clean(inline));
        else if (row) row[key] += (row[key] ? "\n" : "") + inline;
      }
      continue;
    }
    // Numbered subsections stay in their parent step, even after a duration field.
    if (row && /^\d+[A-Z]\s*[—–:-]\s*\S/i.test(line)) {
      target = "actions";
      continuedPrinciple = undefined;
      row.actions += (row.actions ? "\n" : "") + clean(line);
      continue;
    }
    if (continuedPrinciple !== undefined)
      principles[continuedPrinciple] += ` ${clean(line)}`;
    if (
      target === "principles" ||
      /\b(?:must|never|avoid|do not|only after|always)\b/i.test(line)
    ) {
      principles.push(clean(line));
      if (line.endsWith(":")) continuedPrinciple = principles.length - 1;
    }
    // An imperative caution is guidance, rather than an observable completion event.
    if (
      target === "criteria" &&
      /^if\b.*\b(?:do not|never)\b/i.test(line) &&
      !/^[✔✓•*-]/u.test(line)
    )
      continue;
    if (row && target !== "principles")
      row[target] += (row[target] ? "\n" : "") + clean(line);
  }
  if (!rows.length) {
    const actionable = rawLines
      .map(clean)
      .filter((l) => l && !field(l) && !/^#+\s/.test(l));
    const parts =
      actionable.length > 1 ? actionable : text.split(/(?<=[.!?])\s+(?=[A-Z])/);
    for (const sentence of parts) {
      if (sentence.trim())
        rows.push({
          step: sentence.slice(0, 110),
          objective: sentence,
          instruments: "",
          actions: sentence,
          criteria: "",
          duration: "",
        });
    }
  }
  const workflow = rowsToWorkflow(rows, title, "document", principles);
  if (!hasExplicit && !rawLines.some((l) => numbered.test(l)))
    workflow.warnings.push(
      "Unstructured document: review the extracted actions or refine them with AI.",
    );
  return { rows, workflow };
}
export const ObservationSchema = z.object({
  summary: z.string().max(2000),
  guidance: z.string().max(2000),
  principle: z.string().max(1000).default(""),
  current_step_id: z.string().max(100).nullable().default(null),
  // Phase identity can be supported by an ongoing visual episode even when
  // the latest image cannot establish an individual completion criterion.
  phase_evidence: z.object({
    confidence: z.number().min(0).max(1),
    evidence: z.string().max(1000),
    frame_indices: z.array(z.number().int().min(0).max(8)).max(9),
    continuity: z.boolean(),
  }).nullable().optional(),
  status: z.enum(["ok", "watch", "alert"]).default("ok"),
  concern: z.string().max(2000).default(""),
  steps: z
    .array(
      z.object({
        id: z.string().max(100),
        confidence: z.number().min(0).max(1),
        criteria: z
          .array(
            z.object({
              key: z.string().max(100),
              status: z.enum(["unknown", "partial", "met", "not_met"]),
              evidence: z.string().max(1000).default(""),
              frame_indices: z
                .array(z.number().int().min(0).max(8))
                .max(9)
                .default([]),
            }),
          )
          .max(40),
      }),
    )
    .max(100)
    .default([]),
  discovered_steps: z.array(RefRowSchema).max(30).default([]),
});
export type Observation = z.infer<typeof ObservationSchema>;
export function workflowContext(
  workflow: Workflow,
  currentId: string,
  expert: string,
): string {
  const compact = workflow.steps.map((s) => ({
    id: s.id,
    name: s.name,
    objective: s.objective,
    expected_instruments: s.expectedInstruments,
    actions: s.actions,
    criteria: s.criteria.map((c) => ({
      key: c.key,
      label: c.label,
      status: c.status,
    })),
    complete: s.complete,
  }));
  return JSON.stringify({
    title: workflow.title,
    source: workflow.source,
    step_index: compact.map((s) => ({ id: s.id, name: s.name })),
    // Playback can jump to any step. Hiding distant actions or criterion keys
    // would make the previous selection determine what the model can recognize.
    steps: compact,
    principles: workflow.principles,
    document: expert.length <= 16000 ? expert : "",
    document_excerpt_note:
      expert.length > 16000
        ? "Full actions and criteria extracted into steps; all steps are above."
        : undefined,
  });
}
