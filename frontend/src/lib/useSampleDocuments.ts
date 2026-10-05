import { useQuery } from "@tanstack/react-query";
import { apiJson } from "./api";

type SampleDocument = { filename: string; name: string };
export type SampleVideo = {
  id: string;
  name: string;
  description: string;
  guidance: string;
  default: boolean;
  duration_s: number;
  source_url?: string;
  author?: string;
  license?: string;
  license_url?: string;
  excerpt?: {
    start_s: number;
    end_s: number;
    source_duration_s?: number;
    description?: string;
  };
  changes?: string;
};
type SampleCatalog = { documents: SampleDocument[]; videos?: SampleVideo[] };

const settings = (apiBase: string) => ({
  queryKey: ["sample-catalog", apiBase],
  queryFn: ({ signal }: { signal: AbortSignal }) =>
    apiJson<SampleCatalog>(`${apiBase}/api/samples`, { signal }),
  staleTime: 5 * 60_000,
  gcTime: 15 * 60_000,
  retry: false,
  refetchOnWindowFocus: false,
});

/** Public library metadata is shared between setup and the sources drawer. */
export function useSampleDocuments(apiBase: string) {
  return useQuery({
    ...settings(apiBase),
    select: (response) => response.documents,
  });
}

export function useSampleVideos(apiBase: string) {
  return useQuery({
    ...settings(apiBase),
    select: (response) => response.videos ?? [],
  });
}
