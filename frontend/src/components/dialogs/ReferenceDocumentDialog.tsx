import { apiFetch } from "@/lib/api";
// ReferenceDocumentDialog — browse & edit the RAW reference document itself
// (the uploaded expert .txt/.csv text), not the parsed table. The raw text is
// injected into every LLM prompt as the "Expert description", so edits here
// change grounding directly. Saving can optionally re-run the parser so the
// editable table rows follow the edited document.

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
import { FileText, Save, TableProperties } from "lucide-react";
import { toast } from "sonner";

export function ReferenceDocumentDialog({
  children,
  onSaved,
}: {
  children: React.ReactNode;
  onSaved?: () => void;
}) {
  const a = useApp();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [filename, setFilename] = useState("");
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);

  // Load the server's current document whenever the dialog opens.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await apiFetch(`${a.apiBase}/api/reference/document`);
        const j = await res.json();
        if (cancelled || !j.ok) return;
        setText(j.text ?? "");
        setFilename(j.filename ?? "");
        setDirty(false);
      } catch {
        toast.error(`Cannot reach backend at ${a.apiBase}`);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, a.apiBase]);

  const save = async (reparse: boolean) => {
    setBusy(true);
    try {
      const res = await apiFetch(`${a.apiBase}/api/reference/document`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, reparse }),
      });
      const j = await res.json();
      if (!j.ok) throw new Error(j.error ?? "save failed");
      setDirty(false);
      a.addLog({
        ts: Date.now(),
        level: "info",
        source: "Reference",
        msg: `Reference document saved (${j.chars} chars)${reparse ? ` — table re-parsed into ${j.rows_count} row(s)` : ""}`,
      });
      toast.success(
        reparse
          ? `Saved & re-parsed into ${j.rows_count} row(s)`
          : "Document saved — grounding every LLM prompt",
      );
      if (!filename) setFilename("(edited in app)");
      onSaved?.();
    } catch (err) {
      toast.error(`Save failed: ${String(err)}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileText className="h-4 w-4 text-primary" />
            Reference Document
            <Badge
              variant={filename ? "default" : "outline"}
              className="text-[10px]"
            >
              {filename || "no document yet"}
            </Badge>
            {dirty && (
              <Badge
                variant="outline"
                className="text-[10px] text-warning border-warning/50"
              >
                unsaved
              </Badge>
            )}
          </DialogTitle>
        </DialogHeader>
        <p className="text-[11px] text-muted-foreground -mt-2">
          This raw text reaches the LLM as the{" "}
          <span className="font-mono">Expert description</span> in every prompt
          with its extracted actions and criteria. Edit freely — or paste a
          protocol here without uploading a file.
        </p>
        <textarea
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setDirty(true);
          }}
          placeholder={
            "No document uploaded yet.\n\nPaste or type your expert protocol here — e.g.\n\nStep 1 - Exposure\nObjective: ...\nInstruments: ...\nActions: ...\nCompletion Criteria: ...\nTypical duration: ..."
          }
          spellCheck={false}
          className="h-[46vh] w-full resize-y rounded-md border border-input bg-muted/20 p-3 font-mono text-xs leading-relaxed focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring scrollbar-thin"
        />
        <div className="text-[10px] text-muted-foreground text-right -mt-2">
          {text.length.toLocaleString()} chars
        </div>
        <DialogFooter className="gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => save(true)}
            disabled={busy || !text.trim()}
            className="gap-1.5"
          >
            <TableProperties className="h-3.5 w-3.5" /> Save &amp; re-parse
            table
          </Button>
          <Button
            size="sm"
            onClick={() => save(false)}
            disabled={busy}
            className="gap-1.5"
          >
            <Save className="h-3.5 w-3.5" />{" "}
            {busy ? "Saving…" : "Save document"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
