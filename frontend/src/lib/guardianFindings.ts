import type { ReviewResponse } from "./reviewTypes";

/** Recorded current-moment Guardian concerns; demo and whole-video samples stay separate. */
export function guardianFindings(review: ReviewResponse | null) {
  return (
    review?.events
      .filter(
        (event) =>
          event.source_id === review.source_id &&
          event.kind !== "bookmark" &&
          !event.simulated &&
          event.observation_scope !== "overview" &&
          (event.provenance === "ai" || event.provenance === "system") &&
          (event.status === "watch" || event.status === "alert"),
      )
      .slice()
      .reverse() ?? []
  );
}
