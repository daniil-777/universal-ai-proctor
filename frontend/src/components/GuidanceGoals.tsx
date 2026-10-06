import { useEffect, useId, useRef, useState } from "react";
import { Target, Loader2, Check } from "lucide-react";
import { useApp } from "@/lib/store";
import { Button } from "./ui/button";
import { Textarea } from "./ui/textarea";
import { Label } from "./ui/label";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "./ui/dialog";

const suggestions = ["Explain the principle behind each action.", "Focus on deviations from my instructions.", "Keep guidance brief and practical."];
export function GuidanceGoals({ compact = false }: { compact?: boolean }) {
  const a = useApp();
  const id = useId();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const initialized = useRef(false);
  const [draftRevision, setDraftRevision] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const changeOpen = (value: boolean) => {
    if (busy) return;
    if (value) { initialized.current = a.preferencesReady; setDraft(a.operatorGoals); setDraftRevision(a.preferencesRevision); setError(null); }
    setOpen(value);
  };
  useEffect(() => {
    if (open && a.preferencesReady && !initialized.current) {
      initialized.current = true; setDraft(a.operatorGoals); setDraftRevision(a.preferencesRevision);
    }
  }, [open, a.preferencesReady, a.operatorGoals, a.preferencesRevision]);
  const save = async () => {
    setBusy(true); setError(null);
    try { await a.saveOperatorGoals(draft, draftRevision); setOpen(false); }
    catch (err) { setError(err instanceof Error ? err.message : "Could not save your goals."); }
    finally { setBusy(false); }
  };
  return <Dialog open={open} onOpenChange={changeOpen}>
    <DialogTrigger asChild>
      <Button variant="outline" size={compact ? "icon" : "default"} className={compact ? "h-11 w-11 relative" : "h-11 gap-2 rounded-md"} aria-label="Guidance goals" title="Guidance goals">
        <Target className="h-4 w-4" />{!compact && "Guidance goals"}
        {a.operatorGoals && (compact ? <span aria-hidden="true" className="absolute top-1.5 right-1.5 h-1.5 w-1.5 rounded-full bg-primary" /> : <Check className="h-3.5 w-3.5" />)}
      </Button>
    </DialogTrigger>
    <DialogContent className="sm:max-w-xl">
      <DialogHeader>
        <div className="h-11 w-11 grid place-items-center rounded-xl bg-primary/10 text-primary mb-2"><Target className="h-5 w-5" /></div>
        <DialogTitle>What should your guide focus on?</DialogTitle>
        <DialogDescription>Tell your guide what to focus on, how to explain it, or which language to use.</DialogDescription>
      </DialogHeader>
      <div className="space-y-3">
        <Label htmlFor={id}>Your wishes for this session</Label>
        <Textarea id={id} value={draft} onChange={e => setDraft(e.target.value)} maxLength={2000} disabled={busy || !a.preferencesReady} rows={6} className="resize-y min-h-36 text-base leading-relaxed" placeholder="For example: explain each action in simple English, highlight missed checks, and tell me what evidence you can see." aria-describedby={`${id}-hint ${id}-count`} />
        <div className="flex justify-between gap-3 text-xs text-muted-foreground"><span id={`${id}-hint`}>Optional. Leave empty to use standard guidance.</span><span id={`${id}-count`} className="shrink-0" aria-live="polite">{draft.length} / 2,000</span></div>
        <div className="flex flex-wrap gap-2" aria-label="Suggested goals">{suggestions.map(s => <button key={s} type="button" disabled={busy || !a.preferencesReady} className="min-h-11 rounded-md border px-3 py-2 text-left text-xs hover:bg-muted disabled:opacity-50" onClick={() => setDraft(d => `${d.trim()}${d.trim() ? "\n" : ""}${s}`.slice(0, 2000))}>{s}</button>)}</div>
        <p className="rounded-xl bg-muted p-3 text-xs leading-relaxed text-muted-foreground">Your wishes shape Guardian guidance and answers for this session. Steps and principles still follow your document; progress needs visible evidence.</p>
        {(error || a.preferencesError) && <div role="alert" className="text-sm text-destructive">{error || a.preferencesError}<Button variant="outline" className="ml-2 h-11" disabled={busy} onClick={async () => { const saved = await a.refreshPreferences(); if (saved) { setDraftRevision(saved.preferences_revision); setError(null); } }}>Reload saved goals</Button></div>}
        {!a.preferencesReady && !a.preferencesError && <p role="status" className="text-sm text-muted-foreground">Loading your session goals…</p>}
      </div>
      <div className="flex flex-wrap justify-end gap-2">
        <Button variant="ghost" className="h-11" disabled={busy} onClick={() => setDraft("")}>Clear wishes</Button>
        <Button variant="outline" className="h-11" disabled={busy} onClick={() => changeOpen(false)}>Cancel</Button>
        <Button className="h-11 gap-2" disabled={busy || !a.preferencesReady} onClick={() => void save()}>{busy && <Loader2 className="h-4 w-4 animate-spin" />}Save goals</Button>
      </div>
    </DialogContent>
  </Dialog>;
}
