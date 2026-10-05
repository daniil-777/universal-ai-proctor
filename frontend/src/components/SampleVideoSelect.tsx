import { useApp } from "@/lib/store";
import { useSampleVideos } from "@/lib/useSampleDocuments";
import { Button } from "./ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./ui/select";

function clock(seconds: number) {
  const whole = Math.max(0, Math.floor(seconds));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}

function externalLink(value?: string) {
  try {
    return value && new URL(value).protocol === "https:" ? value : undefined;
  } catch {
    return undefined;
  }
}

export function SampleVideoSelect() {
  const a = useApp();
  const catalog = useSampleVideos(a.apiBase);
  // Only the server's explicit bundled id carries attribution through reloads.
  // A restored custom upload may have the same name and no local File object.
  const selected =
    a.sourceKind === "video" &&
    a.sourceReady &&
    a.serverVideoReady &&
    !a.sourceFile
      ? catalog.data?.find((sample) => sample.id === a.sampleVideoId)
      : undefined;
  const sourceLink = externalLink(selected?.source_url);
  const licenseLink = externalLink(selected?.license_url);
  return (
    <div className="min-w-0 space-y-2">
      <Select
        value=""
        onValueChange={(id) => {
          const sample = catalog.data?.find((item) => item.id === id);
          if (sample) void a.loadSampleVideo(id, sample.name);
        }}
        disabled={
          catalog.isPending ||
          a.uploading ||
          a.referenceLoading ||
          !catalog.data?.length
        }
      >
        <SelectTrigger
          aria-label="Choose a sample video"
          className="min-h-11 text-xs"
        >
          <SelectValue
            placeholder={
              a.uploading ? "Loading video…" : "Choose a sample video"
            }
          />
        </SelectTrigger>
        <SelectContent>
          {catalog.data?.map((sample) => (
            <SelectItem
              key={sample.id}
              value={sample.id}
              textValue={sample.name}
              className="min-h-11 py-2"
            >
              <span className="block">{sample.name}</span>
              <span className="block text-[11px] leading-relaxed text-muted-foreground">
                {sample.default ? "Original default · " : ""}
                {clock(sample.duration_s)} · matching guidance included
              </span>
              {sample.license && (
                <span className="block text-[11px] leading-relaxed text-muted-foreground">
                  {sample.license}
                  {sample.author ? ` · ${sample.author}` : ""}
                </span>
              )}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <p className="text-[11px] leading-relaxed text-muted-foreground">
        Choose a real process video with matching guidance, or the preserved
        original surgery sample.
      </p>
      {selected?.source_url && (
        <div className="space-y-1.5 rounded-md border border-border/70 bg-muted/30 p-3 text-xs leading-relaxed">
          <p className="font-medium text-foreground">{selected.name}</p>
          <p className="text-muted-foreground">{selected.description}</p>
          <p className="text-muted-foreground">
            {selected.author ? `Video by ${selected.author}. ` : ""}
            {selected.license}
          </p>
          {selected.excerpt && (
            <p className="text-muted-foreground">
              Source excerpt {clock(selected.excerpt.start_s)}–
              {clock(selected.excerpt.end_s)}
              {selected.excerpt.source_duration_s !== undefined
                ? ` of ${clock(selected.excerpt.source_duration_s)} original recording`
                : ""}
              . {selected.excerpt.description}
            </p>
          )}
          {selected.changes && (
            <p className="text-muted-foreground">Changes: {selected.changes}</p>
          )}
          {(sourceLink || licenseLink) && (
            <div className="flex flex-wrap gap-x-4">
              {sourceLink && (
                <a
                  href={sourceLink}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex min-h-11 items-center font-medium text-primary underline underline-offset-4"
                >
                  Original source
                </a>
              )}
              {licenseLink && (
                <a
                  href={licenseLink}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex min-h-11 items-center font-medium text-primary underline underline-offset-4"
                >
                  Video license
                </a>
              )}
            </div>
          )}
        </div>
      )}
      {catalog.isError && (
        <div role="status" className="text-xs text-muted-foreground">
          <span>Sample videos could not load.</span>
          <Button
            size="sm"
            variant="ghost"
            className="min-h-11"
            disabled={catalog.isFetching}
            onClick={() => void catalog.refetch()}
          >
            Retry video samples
          </Button>
        </div>
      )}
      {!catalog.isPending && !catalog.isError && !catalog.data?.length && (
        <p className="text-xs text-muted-foreground">
          No bundled videos are installed. Upload a video to continue.
        </p>
      )}
    </div>
  );
}
