import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { VideoLibraryLink } from "./VideoLibraryLink";

afterEach(cleanup);

it("opens the real video and instruction library while preserving the current setup", () => {
  render(<VideoLibraryLink />);
  const link = screen.getByRole("link", { name: "Videos & instructions" });
  expect(link).toHaveAttribute("href", "/media/process-guide-real-scenarios/index.html");
  expect(link).toHaveAttribute("target", "_blank");
  expect(link).toHaveAttribute("rel", "noopener noreferrer");
  expect(link).toHaveAccessibleDescription(/5 real processes · videos \+ TXT guides.*Opens in a new tab\./);
  expect(link).toBeVisible();
});
