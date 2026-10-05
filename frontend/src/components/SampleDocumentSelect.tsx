import { useApp } from "@/lib/store";
import { useSampleDocuments } from "@/lib/useSampleDocuments";
import { Button } from "./ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./ui/select";

export function SampleDocumentSelect({
  label,
  placeholder,
}: {
  label: string;
  placeholder: string;
}) {
  const a = useApp();
  const library = useSampleDocuments(a.apiBase);
  return (
    <div className="min-w-0">
      <Select
        value=""
        onValueChange={(name) => void a.loadSample(name)}
        disabled={
          library.isPending || a.referenceLoading || !library.data?.length
        }
      >
        <SelectTrigger aria-label={label} className="text-xs">
          <SelectValue
            placeholder={
              library.isPending ? "Loading sample documents…" : placeholder
            }
          />
        </SelectTrigger>
        <SelectContent>
          {library.data?.map((s) => (
            <SelectItem key={s.filename} value={s.filename}>
              {s.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {library.isError && (
        <div
          className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground"
          role="status"
        >
          <span>Sample documents could not load.</span>
          <Button
            size="sm"
            variant="outline"
            disabled={library.isFetching}
            onClick={() => void library.refetch()}
          >
            Retry samples
          </Button>
        </div>
      )}
    </div>
  );
}
