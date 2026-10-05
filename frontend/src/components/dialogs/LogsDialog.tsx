import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { LogsTab } from "../right-rail/LogsTab";

export function LogsDialog({ children }: { children: React.ReactNode }) {
  return (
    <Dialog>
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent className="max-w-3xl h-[70vh] flex flex-col p-0 overflow-hidden">
        <DialogHeader className="px-4 pt-4">
          <DialogTitle>Live logs</DialogTitle>
        </DialogHeader>
        <div className="flex-1 overflow-hidden">
          <LogsTab />
        </div>
      </DialogContent>
    </Dialog>
  );
}
