import { afterEach, describe, expect, it, vi } from "vitest";
import { canShareReport, downloadReport, reportFilename, shareReport } from "./reportShare";

const file = () => new File(["%PDF-fixture"], "Process-Guide-inspection.pdf", { type: "application/pdf" });
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });
function downloads() {
  vi.useFakeTimers(); const create = vi.fn(() => "blob:report"), revoke = vi.fn();
  vi.stubGlobal("URL", Object.assign(URL, { createObjectURL: create, revokeObjectURL: revoke }));
  const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
  return { create, revoke, click };
}
describe("report file sharing", () => {
  it("shares a prepared PDF directly without a network request", async () => {
    const share = vi.fn().mockResolvedValue(undefined), canShare = vi.fn(() => true);
    vi.stubGlobal("navigator", { share, canShare }); const pdf = file();
    expect(await shareReport(pdf)).toBe("shared"); expect(share).toHaveBeenCalledWith({ files: [pdf], title: "Process Guide session report" });
  });
  it("falls back to a named downloadable file when file sharing is unsupported", async () => {
    vi.stubGlobal("navigator", {}); const { create, revoke, click } = downloads();
    expect(await shareReport(file())).toBe("downloaded"); expect(create).toHaveBeenCalledTimes(1); expect(click).toHaveBeenCalledTimes(1);
    expect(revoke).not.toHaveBeenCalled(); vi.advanceTimersByTime(60_000); expect(revoke).toHaveBeenCalledWith("blob:report");
    expect(document.querySelector("a[download]")).toBeNull();
  });
  it("treats dismissing the native share menu as cancellation", async () => {
    vi.stubGlobal("navigator", { canShare: () => true, share: vi.fn().mockRejectedValue(new DOMException("Cancelled", "AbortError")) });
    expect(await shareReport(file())).toBe("cancelled");
  });
  it("surfaces sharing failures instead of silently sending a second copy", async () => {
    vi.stubGlobal("navigator", { canShare: () => true, share: vi.fn().mockRejectedValue(new Error("Device policy")) });
    await expect(shareReport(file())).rejects.toThrow("Device policy");
  });
  it("handles browsers throwing from capability detection and normalizes portable filenames", () => {
    vi.stubGlobal("navigator", { share: vi.fn(), canShare: () => { throw new Error("Unsupported"); } });
    expect(canShareReport(file())).toBe(false); expect(reportFilename("../Inspection: Größe?", "pdf")).toBe("Process-Guide-Inspection-Größe.pdf");
    expect(reportFilename("", "html")).toBe("Process-Guide-session.html");
    const { click } = downloads(); downloadReport(file()); expect(click).toHaveBeenCalledOnce();
  });
});
