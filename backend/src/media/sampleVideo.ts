import fs from "node:fs/promises";
import { statSync } from "node:fs";
import path from "node:path";
import { probeVideo } from "../pipeline/frames.js";

/** Bundled media only. Source URLs describe attribution, never runtime fetches. */
export interface SampleVideoDefinition {
  id: string;
  name: string;
  filename: string;
  guidance: string;
  description: string;
  default: boolean;
  duration_s: number;
  bytes?: number;
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
}

export const SURGERY_SAMPLE = {
  id: "original-cholecystectomy",
  name: "Uncomplicated cholecystectomy",
  filename: "uncomplicated-cholecystectomy.mp4",
  guidance: "Cholecystectomy.txt",
  description: "Original default surgery training video",
  default: true,
  duration_s: 252.766667,
  bytes: 37_894_412,
} as const;

function validBundledPaths(sample: SampleVideoDefinition) {
  return (
    path.basename(sample.filename) === sample.filename &&
    /^[a-zA-Z0-9_.-]+\.mp4$/.test(sample.filename) &&
    path.basename(sample.guidance) === sample.guidance &&
    /^[a-zA-Z0-9_.-]+\.txt$/.test(sample.guidance)
  );
}

/** Incomplete installs stay out of the public menu until both files are ready. */
export function sampleVideoAvailable(
  sample: SampleVideoDefinition,
  sampleRoot: string,
  library: string,
) {
  if (!validBundledPaths(sample)) return false;
  try {
    return (
      statSync(path.join(sampleRoot, sample.filename)).isFile() &&
      statSync(path.join(library, sample.guidance)).isFile()
    );
  } catch {
    return false;
  }
}

/** Immutable bundled recordings get a disposable link/copy owned by one session. */
export async function stageSampleVideo(
  sample: SampleVideoDefinition,
  sampleRoot: string,
  library: string,
  target: string,
) {
  if (!validBundledPaths(sample)) throw new Error("Invalid bundled sample paths.");
  const source = path.join(sampleRoot, sample.filename);
  const text = await fs.readFile(path.join(library, sample.guidance), "utf8");
  try {
    try {
      await fs.link(source, target);
    } catch (error) {
      if (
        !["EXDEV", "EPERM", "ENOTSUP", "EACCES"].includes(
          (error as NodeJS.ErrnoException).code || "",
        )
      )
        throw error;
      await fs.copyFile(source, target);
    }
    const info = await probeVideo(target);
    if (!info.duration || !info.width || !info.height)
      throw new Error("The sample has no playable video stream.");
    return { info, text };
  } catch (error) {
    await fs.rm(target, { force: true });
    throw error;
  }
}

/** Kept for integrations which explicitly request the preserved original sample. */
export const stageSurgerySample = (sampleRoot: string, library: string, target: string) =>
  stageSampleVideo(SURGERY_SAMPLE, sampleRoot, library, target);
