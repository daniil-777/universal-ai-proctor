export function canShareReport(file: File): boolean {
  try {
    return (
      typeof navigator.share === "function" &&
      typeof navigator.canShare === "function" &&
      navigator.canShare({ files: [file] })
    );
  } catch {
    return false;
  }
}

/** Call directly from a click after preparing the file, preserving browser user activation. */
export async function shareReport(
  file: File,
  title = "Process Guide session report",
): Promise<"shared" | "cancelled" | "downloaded"> {
  if (!canShareReport(file)) {
    downloadReport(file);
    return "downloaded";
  }
  try {
    await navigator.share({ files: [file], title });
    return "shared";
  } catch (error) {
    if ((error as Error).name === "AbortError") return "cancelled";
    throw error;
  }
}

export function downloadReport(file: File) {
  const url = URL.createObjectURL(file);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = file.name;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  // Safari needs the URL alive while it transfers the generated file to its download manager.
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export function reportFilename(title: string, format: "pdf" | "html") {
  const name =
    title
      .normalize("NFKC")
      .replace(/[^\p{L}\p{N} _-]/gu, "")
      .trim()
      .replace(/\s+/g, "-")
      .slice(0, 64) || "session";
  return `Process-Guide-${name}.${format}`;
}
