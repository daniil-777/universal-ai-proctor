import { useCallback, useEffect, useRef, useState } from "react";
import { apiFetch } from "./api";
import { parseReviewPayload } from "./reviewPayload";
import type {
  ReadinessUpdate,
  ReviewResponse,
  ReviewStatus,
} from "./reviewTypes";

export function useSessionReview(
  apiBase: string,
  sourceId: string,
  ready: boolean,
  revision: number,
  observed: unknown,
) {
  const [review, setReview] = useState<ReviewResponse | null>(null);
  const [reviewLoading, setLoading] = useState(false);
  const [reviewBusy, setBusy] = useState(false);
  const [reviewError, setError] = useState("");
  const [reviewImagesEnabled, setReviewImagesEnabled] = useState(false);
  const context = `${apiBase}|${sourceId}`;
  const latest = useRef({ context, review, ready });
  latest.current = { context, review, ready };
  const active = useRef(new Set<AbortController>());
  const reading = useRef<AbortController | null>(null);
  const pendingRead = useRef(false);
  const refreshCurrent = useRef<() => Promise<void>>();
  const mutation = useRef(false);

  const request = useCallback(
    async (route: string, init: RequestInit = {}) => {
      const owner = context;
      const controller = new AbortController();
      active.current.add(controller);
      const timer = setTimeout(() => controller.abort(), 15000);
      try {
        const response = await apiFetch(`${apiBase}${route}`, {
          ...init,
          signal: controller.signal,
        });
        const payload = await response.json();
        if (latest.current.context !== owner || controller.signal.aborted)
          throw new DOMException("Context changed", "AbortError");
        if (!response.ok || !payload?.ok)
          throw new Error(
            payload?.error || `Review request failed (${response.status})`,
          );
        const data = parseReviewPayload(payload);
        if (data.source_id !== sourceId)
          throw new Error("The input changed. Refresh the review.");
        setReview((previous) => {
          if (
            previous?.source_id === data.source_id &&
            previous.review_version > data.review_version
          )
            return previous;
          if (previous?.source_id === data.source_id) {
            const thumbnails = new Map(
              previous.events.map((event) => [event.id, event.thumbnail_b64]),
            );
            data.events = data.events.map((event) =>
              event.thumbnail_available && !event.thumbnail_b64
                ? { ...event, thumbnail_b64: thumbnails.get(event.id) }
                : event,
            );
          }
          return data;
        });
        setError("");
        return data as ReviewResponse;
      } finally {
        clearTimeout(timer);
        active.current.delete(controller);
      }
    },
    [apiBase, context, sourceId],
  );

  const refreshReview = useCallback(async () => {
    if (!latest.current.ready) return;
    if (reading.current) {
      pendingRead.current = true;
      return;
    }
    const marker = new AbortController();
    reading.current = marker;
    setLoading(true);
    try {
      await request(`/api/review?include_images=${reviewImagesEnabled}`);
    } catch (e) {
      if (
        latest.current.context === context &&
        (e as Error).name !== "AbortError"
      )
        setError((e as Error).message);
    } finally {
      if (reading.current === marker) {
        reading.current = null;
        setLoading(false);
        if (pendingRead.current) {
          pendingRead.current = false;
          queueMicrotask(() => void refreshCurrent.current?.());
        }
      }
    }
  }, [request, context, reviewImagesEnabled]);
  refreshCurrent.current = refreshReview;

  useEffect(() => {
    setReview(null);
    setError("");
    setBusy(false);
    setLoading(false);
    mutation.current = false;
    reading.current = null;
    pendingRead.current = false;
    const controllers = active.current;
    return () => {
      for (const controller of controllers) controller.abort();
      controllers.clear();
    };
  }, [context]);
  useEffect(() => {
    void refreshReview();
  }, [ready, revision, observed, refreshReview]);
  useEffect(() => {
    const focus = () => void refreshReview();
    window.addEventListener("focus", focus);
    return () => window.removeEventListener("focus", focus);
  }, [refreshReview]);

  const mutate = useCallback(
    async (route: string, method: string, data: object) => {
      const current = latest.current;
      if (current.context !== context || !current.ready || !current.review)
        throw new Error("Wait for the current review to load.");
      if (mutation.current)
        throw new Error(
          "Another review update is being saved. Try again shortly.",
        );
      mutation.current = true;
      setBusy(true);
      setError("");
      try {
        return await request(route, {
          method,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ...data,
            source_id: sourceId,
            reference_key: current.review.reference_key,
            review_version: current.review.review_version,
          }),
        });
      } catch (e) {
        if (
          latest.current.context === context &&
          (e as Error).name !== "AbortError"
        ) {
          setError((e as Error).message);
          void refreshReview();
        }
        throw e;
      } finally {
        if (latest.current.context === context) {
          mutation.current = false;
          setBusy(false);
        }
      }
    },
    [context, request, sourceId, refreshReview],
  );

  return {
    review,
    reviewLoading,
    reviewBusy,
    reviewError,
    refreshReview,
    setReviewImagesEnabled,
    addReviewBookmark: (data: {
      current_s: number;
      frame_b64: string;
      note?: string;
    }) =>
      mutate("/api/review/bookmarks", "POST", {
        ...data,
        operator_label: latest.current.review?.job.operator,
      }),
    raiseReviewException: (data: {
      title: string;
      description?: string;
      event_id?: string;
    }) =>
      mutate("/api/review/exceptions", "POST", {
        ...data,
        operator_label: latest.current.review?.job.operator,
      }),
    updateReviewException: (id: string, status: ReviewStatus, note: string) =>
      mutate(`/api/review/exceptions/${encodeURIComponent(id)}`, "PATCH", {
        status,
        note,
        operator_label: latest.current.review?.job.operator,
      }),
    saveReadiness: (data: ReadinessUpdate) =>
      mutate("/api/review/readiness", "PUT", data),
  };
}
export type SessionReview = ReturnType<typeof useSessionReview>;
