import { lazy, Suspense, useRef, useState } from "react";
import { Loader2, Play } from "lucide-react";
import { Button, type ButtonProps } from "./ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog";

const WalkthroughDialog = lazy(() => import("./dialogs/WalkthroughDialog"));

export function WalkthroughLauncher({
  className,
  variant = "outline",
  onOpen,
}: {
  className?: string;
  variant?: ButtonProps["variant"];
  onOpen?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const changeOpen = (value: boolean) => {
    setOpen(value);
    if (!value) setTimeout(() => trigger.current?.focus(), 0);
  };
  return (
    <>
      <Button
        ref={trigger}
        className={`min-h-11 gap-2 ${className || ""}`}
        variant={variant}
        onClick={() => {
          onOpen?.();
          setOpen(true);
        }}
      >
        <Play className="size-4" aria-hidden="true" /> See full walkthrough
      </Button>
      {open && (
        <Suspense
          fallback={
            <Dialog open onOpenChange={changeOpen}>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Process Guide walkthrough</DialogTitle>
                  <DialogDescription>
                    Opening the narrated app guide.
                  </DialogDescription>
                </DialogHeader>
                <p
                  className="flex items-center gap-2 text-sm text-muted-foreground"
                  role="status"
                >
                  <Loader2 className="size-4 animate-spin" aria-hidden="true" />{" "}
                  Loading walkthrough…
                </p>
              </DialogContent>
            </Dialog>
          }
        >
          <WalkthroughDialog onOpenChange={changeOpen} />
        </Suspense>
      )}
    </>
  );
}
