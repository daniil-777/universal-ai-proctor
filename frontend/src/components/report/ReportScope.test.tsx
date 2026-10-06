import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { ReviewResponse } from "@/lib/reviewTypes";
import { ReportScope } from "./ReportScope";

describe("report identity and retained scope", () => {
  it("preserves the full long identity and makes retention losses visible before detailed records", () => {
    const identity = "Full manufacturing identity ".repeat(40);
    render(<ReportScope identity={identity} sourceName="Original video" referenceName="Guide.txt" review={{
      source_id: "source", reference_key: "digest", review_version: 4, events: [], notice: "Samples only",
      retention: { dropped_events: 12, dropped_thumbnails: 3, dropped_exceptions: 1 },
    } as ReviewResponse} />);
    const disclosure = screen.getByText("Full report identity and record details").closest("details")!;
    expect(disclosure).toHaveTextContent(identity.trim());
    expect(disclosure.open).toBe(false);
    expect(screen.getByText(/Omitted by retention limits/)).toHaveTextContent("12 records, 3 photos and 1 issue");
    expect(screen.getByText(/do not establish continuous coverage/)).toBeVisible();
  });
});
