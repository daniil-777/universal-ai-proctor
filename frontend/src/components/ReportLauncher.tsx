import {
  Component,
  cloneElement,
  lazy,
  Suspense,
  useState,
  type ReactElement,
  type ReactNode,
  type MouseEvent,
} from "react";
import { Loader2 } from "lucide-react";
import { Button } from "./ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog";

const loadDialog = () =>
  lazy(() =>
    import("./dialogs/ReportDialog").then((module) => ({
      default: module.ReportDialog,
    })),
  );
class LoadBoundary extends Component<
  { children: ReactNode; fallback: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

/** Load report code on its first request, retaining prepared snapshots across reopen. */
export function ReportLauncher({
  children,
}: {
  children: ReactElement<{ onClick?: (event: MouseEvent) => void }>;
}) {
  const [requested, setRequested] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [Report, setReport] = useState(loadDialog);
  const trigger = cloneElement(children, {
    onClick: (event) => {
      children.props.onClick?.(event);
      if (!event.defaultPrevented) {
        setLoaded(true);
        setRequested(true);
      }
    },
  });
  const placeholder = (failed: boolean) => (
    <>
      {trigger}
      <Dialog open={requested} onOpenChange={setRequested}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Session report</DialogTitle>
            <DialogDescription>
              {failed
                ? "The report could not load. Your session records are preserved."
                : "Opening the report and its review tools."}
            </DialogDescription>
          </DialogHeader>
          {failed ? (
            <Button
              onClick={() => {
                setReport(loadDialog);
                setAttempt((value) => value + 1);
              }}
            >
              Retry report
            </Button>
          ) : (
            <p
              role="status"
              className="flex items-center gap-2 text-sm text-muted-foreground"
            >
              <Loader2 className="size-4 animate-spin" />
              Loading report…
            </p>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
  return loaded ? (
    <LoadBoundary key={attempt} fallback={placeholder(true)}>
      <Suspense fallback={placeholder(false)}>
        <Report controlledOpen={requested} onOpenChange={setRequested}>
          {children}
        </Report>
      </Suspense>
    </LoadBoundary>
  ) : (
    trigger
  );
}
