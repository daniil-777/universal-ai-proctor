import { useEffect, useState } from "react";
import { CheckCircle2, Loader2, Plug } from "lucide-react";
import { useApp } from "@/lib/store";
import { apiJson } from "@/lib/api";
import { fullAppUrl, isStaticHosting, normalizeApiBase } from "@/lib/deployment";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "./ui/dialog";

export function BackendConnectionNotice() {
  const a = useApp();
  const [open, setOpen] = useState(false);
  const [address, setAddress] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    const openConnection = () => {
      setAddress(a.apiBase === window.location.origin ? "" : a.apiBase);
      setError("");
      setOpen(true);
    };
    window.addEventListener("guidance-connect-backend", openConnection);
    return () => window.removeEventListener("guidance-connect-backend", openConnection);
  }, [a.apiBase]);
  if (!isStaticHosting()) return null;
  const connected = a.health?.ok === true;
  const fullApp = fullAppUrl();
  const connect = async () => {
    setError("");
    const base = normalizeApiBase(address);
    try {
      const url = new URL(base);
      if (!["https:", "http:"].includes(url.protocol) || url.username || url.password || url.search || url.hash)
        throw new Error("Enter a backend address using HTTP or HTTPS, without credentials or query parameters.");
      if (url.origin === window.location.origin)
        throw new Error("This address is the public preview. Enter the address of your running backend.");
      setBusy(true);
      await apiJson<{ ok: boolean }>(`${base}/api/health`);
      a.setApiBase(base);
      setOpen(false);
    } catch (cause) {
      setError(cause instanceof Error && cause.message.startsWith("Enter ") ||
        cause instanceof Error && cause.message.startsWith("This address")
        ? cause.message
        : "Could not connect. Check the backend address and whether it allows this website to connect.");
    } finally { setBusy(false); }
  };
  return <>
    <aside aria-label="Backend connection" className="flex shrink-0 flex-wrap items-center gap-3 rounded-xl border border-primary/20 bg-primary/5 px-4 py-3 text-foreground">
      <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">
        {connected ? <CheckCircle2 className="size-4" /> : <Plug className="size-4" />}
      </span>
      <div className="min-w-0 flex-1 basis-52">
        <p className="text-xs font-semibold">{connected ? "Analysis backend connected" : "Public preview"}</p>
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
          {connected
            ? "Your connected backend powers analysis. Use the full app for accounts and saved results."
            : "Explore the tours and video library. AI guidance requires a backend; use the full app for accounts and saved results."}
        </p>
      </div>
      {fullApp && <Button asChild className="min-h-11 shrink-0 gap-2 text-xs"><a href={fullApp}>Open full app</a></Button>}
      <Button variant="outline" className="min-h-11 shrink-0 gap-2 text-xs" onClick={() => {
        setAddress(a.apiBase === window.location.origin ? "" : a.apiBase);
        setError(""); setOpen(true);
      }}><Plug className="size-3.5" />{connected ? "Change backend" : "Connect backend"}</Button>
    </aside>
    <Dialog open={open} onOpenChange={value => { if (!busy) setOpen(value); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Connect your AI workspace</DialogTitle>
          <DialogDescription>Connect a running Cueveris backend for analysis. Videos and guidance are sent to that backend. Accounts and saved results are available in the full app.</DialogDescription>
        </DialogHeader>
        <form className="space-y-4" onSubmit={event => { event.preventDefault(); void connect(); }}>
          <div className="space-y-2"><Label htmlFor="backend-address">Backend address</Label>
            <Input id="backend-address" type="url" value={address} onChange={event => setAddress(event.target.value)} placeholder="https://your-backend.example.com" autoComplete="url" required disabled={busy} />
            <p className="text-xs leading-relaxed text-muted-foreground">Use the address of your deployed backend or a running local instance. This connection address is saved on this device.</p>
          </div>
          {error && <p role="alert" className="text-xs leading-relaxed text-destructive">{error}</p>}
          <Button type="submit" className="min-h-11 w-full gap-2" disabled={busy || !address.trim()}>
            {busy && <Loader2 className="size-4 animate-spin" />}{busy ? "Checking connection…" : "Connect workspace"}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  </>;
}
