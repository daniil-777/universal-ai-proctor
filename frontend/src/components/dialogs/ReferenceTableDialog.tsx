import { apiFetch } from "@/lib/api";
// ReferenceTableDialog — editable reference-data table (port of the Python
// reference_data_dialog): loads the server's parsed rows (uploaded expert file
// or extracted steps), supports edit / add / duplicate / delete, Save persists
// to the backend where the rows ground every LLM prompt, Export downloads CSV,
// Reset returns to the built-in stage table.

import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useApp } from "@/lib/store";
import { Copy, Plus, RotateCcw, Save, Sparkles, Trash2 } from "lucide-react";
import { toast } from "sonner";

interface Row {
  step: string;
  objective: string;
  instruments: string;
  actions: string;
  criteria: string;
  duration: string;
}
const KEYS = [
  "step",
  "objective",
  "instruments",
  "actions",
  "criteria",
  "duration",
] as const;
const HEADERS = [
  "Step",
  "Objective",
  "Expected Instruments",
  "Actions",
  "Completion Criteria",
  "Typical Duration",
  "",
];

const emptyRow = (): Row => ({
  step: "",
  objective: "",
  instruments: "",
  actions: "",
  criteria: "",
  duration: "",
});

export function ReferenceTableDialog({
  children,
}: {
  children: React.ReactNode;
}) {
  const a = useApp();
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<Row[]>([]);
  const [source, setSource] = useState<"document" | "inferred" | "none">(
    "none",
  );
  const [filename, setFilename] = useState("");
  const [busy, setBusy] = useState(false);
  const [aiBusy, setAiBusy] = useState(false);

  // Load the server's current reference whenever the dialog opens.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await apiFetch(`${a.apiBase}/api/reference`);
        const j = await res.json();
        if (cancelled || !j.ok) return;
        setRows((j.rows as Row[]).map((r) => ({ ...emptyRow(), ...r })));
        setSource(j.source ?? "none");
        setFilename(j.filename ?? "");
      } catch {
        toast.error(`Cannot reach backend at ${a.apiBase}`);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, a.apiBase]);

  const update = (i: number, k: keyof Row, v: string) =>
    setRows((p) => p.map((r, idx) => (idx === i ? { ...r, [k]: v } : r)));
  const dup = (i: number) =>
    setRows((p) => [...p.slice(0, i + 1), { ...p[i]! }, ...p.slice(i + 1)]);
  const del = (i: number) => setRows((p) => p.filter((_, idx) => idx !== i));
  const add = () =>
    setRows((p) => [
      ...p,
      { ...emptyRow(), step: `Step ${p.length + 1} – New step` },
    ]);

  const save = async () => {
    setBusy(true);
    try {
      const res = await apiFetch(`${a.apiBase}/api/reference`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rows }),
      });
      const j = await res.json();
      if (!j.ok) throw new Error(j.error ?? "save failed");
      setSource("document");
      a.addLog({
        ts: Date.now(),
        level: "info",
        source: "Reference",
        msg: `Reference table saved — ${j.rows_count} row(s) now ground every prompt`,
      });
      toast.success(`Saved ${j.rows_count} row(s) — active in all LLM prompts`);
    } catch (err) {
      toast.error(`Save failed: ${String(err)}`);
    } finally {
      setBusy(false);
    }
  };

  const reset = async () => {
    setBusy(true);
    try {
      await apiFetch(`${a.apiBase}/api/reference`, { method: "DELETE" });
      const res = await apiFetch(`${a.apiBase}/api/reference`);
      const j = await res.json();
      if (j.ok) {
        setRows(j.rows as Row[]);
        setSource("none");
        setFilename("");
      }
      toast("Guidance cleared");
    } catch (err) {
      toast.error(`Reset failed: ${String(err)}`);
    } finally {
      setBusy(false);
    }
  };

  // AI distributes the raw uploaded document into the 6 columns (port of the
  // Python dialog's "Parse with AI" — for free-form text without labeled fields).
  const parseAi = async () => {
    setAiBusy(true);
    try {
      const res = await apiFetch(`${a.apiBase}/api/reference/parse-ai`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider: a.model.provider,
          model_id: a.model.model_id,
        }), // server uses the raw text of the last upload
      });
      const j = await res.json();
      if (!j.ok) {
        toast.error(
          j.error === "AI parse failed"
            ? `AI parse failed: ${j.detail ?? ""}`
            : (j.error ?? "AI parse failed"),
        );
        return;
      }
      setRows((j.rows as Row[]).map((r) => ({ ...emptyRow(), ...r })));
      setSource("document");
      a.addLog({
        ts: Date.now(),
        level: "info",
        source: "Reference",
        msg: `AI parsed the reference file into ${j.rows_count} step(s)`,
      });
      toast.success(
        `AI distributed the document into ${j.rows_count} step(s)${j.procedure_name ? ` · ${j.procedure_name}` : ""}`,
      );
    } catch (err) {
      toast.error(`AI parse failed: ${String(err)}`);
    } finally {
      setAiBusy(false);
    }
  };

  const exportCsv = () => {
    const esc = (s: string) => `"${(s ?? "").replace(/"/g, '""')}"`;
    const csv = [
      HEADERS.slice(0, 6).join(","),
      ...rows.map((r) => KEYS.map((k) => esc(r[k])).join(",")),
    ].join("\r\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "reference-table.csv";
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    toast.success("Exported reference-table.csv");
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent className="max-w-6xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            Reference Data Table
            <Badge
              variant={source === "document" ? "default" : "outline"}
              className="text-[10px]"
            >
              {source === "document"
                ? filename || "uploaded / edited"
                : "extracted steps"}
            </Badge>
          </DialogTitle>
        </DialogHeader>
        <p className="text-[11px] text-muted-foreground -mt-2">
          These rows (plus the raw expert file) are injected into every LLM
          prompt as
          <span className="font-mono"> REFERENCE DATA</span> — see the Prompt
          tab after asking.
        </p>
        <div className="border border-border rounded-md overflow-auto max-h-[60vh]">
          <table className="w-full text-xs">
            <thead className="bg-muted/40 sticky top-0 z-10">
              <tr>
                {HEADERS.map((h) => (
                  <th
                    key={h}
                    className="text-left p-2 font-medium border-b border-border"
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i} className="border-b border-border align-top">
                  {KEYS.map((k) => (
                    <td key={k} className="p-1 min-w-[150px]">
                      <textarea
                        value={r[k]}
                        onChange={(e) => update(i, k, e.target.value)}
                        rows={Math.min(
                          5,
                          Math.max(1, (r[k].match(/\n/g)?.length ?? 0) + 1),
                        )}
                        className="w-full resize-y rounded border border-input bg-background px-2 py-1 text-xs leading-snug focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                      />
                    </td>
                  ))}
                  <td className="p-1 whitespace-nowrap">
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-7 w-7"
                      title="Duplicate row"
                      onClick={() => dup(i)}
                    >
                      <Copy className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-7 w-7"
                      title="Delete row"
                      onClick={() => del(i)}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <DialogFooter className="gap-2">
          <Button variant="outline" size="sm" onClick={add} className="gap-1.5">
            <Plus className="h-3.5 w-3.5" /> Add row
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={parseAi}
            disabled={busy || aiBusy}
            title="Let the AI distribute the raw uploaded document into these columns"
            className="gap-1.5 border-primary/50 text-primary hover:bg-primary/10"
          >
            <Sparkles
              className={`h-3.5 w-3.5 ${aiBusy ? "animate-pulse" : ""}`}
            />{" "}
            {aiBusy ? "Parsing with AI…" : "Parse with AI"}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={reset}
            disabled={busy || aiBusy}
            className="gap-1.5"
          >
            <RotateCcw className="h-3.5 w-3.5" /> Clear workflow
          </Button>
          <Button variant="outline" size="sm" onClick={exportCsv}>
            Export CSV
          </Button>
          <Button
            size="sm"
            onClick={save}
            disabled={busy || aiBusy}
            className="gap-1.5"
          >
            <Save className="h-3.5 w-3.5" /> {busy ? "Saving…" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
