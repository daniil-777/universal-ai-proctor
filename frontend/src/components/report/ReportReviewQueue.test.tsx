import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Stage } from "@/lib/types";
import { ReportReviewQueue } from "./ReportReviewQueue";

describe("criterion follow-up handoff", () => {
  it("keeps unknown criteria visible on manually confirmed steps and targets the exact step without changing it", () => {
    const stages = [{ id: "manual", name: "Assemble", complete: true, confirmation: "manual",
      criteria: [{ key: "unknown", label: "Hidden check", status: "unknown" }] }] as Stage[];
    const snapshot = JSON.stringify(stages);
    const onReview = vi.fn();
    render(<ReportReviewQueue stages={stages} onReview={onReview} />);
    expect(screen.getByText("Manual confirmation")).toBeVisible();
    expect(screen.getByText("Hidden check")).toBeVisible();
    expect(screen.getByText("1 unknown")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Review step Assemble" }));
    expect(onReview).toHaveBeenCalledWith("manual");
    expect(JSON.stringify(stages)).toBe(snapshot);
  });
});
