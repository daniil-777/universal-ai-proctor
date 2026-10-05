import { useCallback, useEffect, useRef, useState } from "react";
import { apiFetch } from "./api";

type Preferences = { operator_goals: string; preferences_revision: number };
export function useGuidancePreferences(apiBase: string) {
  const [value, setValue] = useState<Preferences>({ operator_goals: "", preferences_revision: 0 });
  const [preferencesReady, setReady] = useState(false);
  const [preferencesError, setError] = useState<string | null>(null);
  const epoch = useRef(0);
  const pending = useRef<AbortController>();
  const saving = useRef(false);
  const revision = useRef(0);
  const request = useCallback(async (goals?: string, expectedRevision?: number) => {
    if (goals === undefined && saving.current) return;
    const ticket = ++epoch.current;
    pending.current?.abort();
    const controller = new AbortController();
    pending.current = controller;
    if (goals !== undefined) saving.current = true;
    const timer = setTimeout(() => controller.abort(), 15000);
    try {
      const response = await apiFetch(`${apiBase}/api/preferences`, goals === undefined
        ? { signal: controller.signal }
        : { method: "PUT", signal: controller.signal, headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ operator_goals: goals, preferences_revision: expectedRevision ?? revision.current }) });
      const body = await response.json();
      if (ticket !== epoch.current) { if (goals !== undefined) throw new Error("The session changed before goals were saved."); return; }
      if (controller.signal.aborted) throw new Error("Guidance goals request timed out. Try again.");
      if (!response.ok || body.ok !== true) throw new Error(body.error || "Could not load guidance goals.");
      if (typeof body.operator_goals !== "string" || !Number.isInteger(body.preferences_revision) || body.preferences_revision < 0)
        throw new Error("The server returned invalid guidance goals.");
      revision.current = body.preferences_revision;
      setValue(body); setReady(true); setError(null);
      return body as Preferences;
    } catch (error) {
      if (ticket !== epoch.current) { if (goals !== undefined) throw new Error("The session changed before goals were saved."); return; }
      const message = controller.signal.aborted ? "Guidance goals request timed out. Try again." : error instanceof Error ? error.message : "Guidance goals are unavailable.";
      setError(message);
      if (goals !== undefined) throw new Error(message);
    } finally {
      clearTimeout(timer);
      if (ticket === epoch.current) { pending.current = undefined; saving.current = false; }
    }
  }, [apiBase]);
  const refreshPreferences = useCallback(() => request(), [request]);
  const saveOperatorGoals = useCallback(async (goals: string, expectedRevision?: number) => {
    if (goals.length > 2000) throw new Error("Use at most 2,000 characters.");
    await request(goals.trim(), expectedRevision);
  }, [request]);
  const cancelRequest = useCallback(() => { epoch.current++; pending.current?.abort(); }, []);
  useEffect(() => {
    setReady(false); setError(null); revision.current = 0; saving.current = false;
    setValue({ operator_goals: "", preferences_revision: 0 });
    void refreshPreferences();
    const focus = () => { if (!document.hidden) void refreshPreferences(); };
    window.addEventListener("focus", focus);
    return () => { cancelRequest(); window.removeEventListener("focus", focus); };
  }, [refreshPreferences, cancelRequest]);
  return { operatorGoals: value.operator_goals, preferencesRevision: value.preferences_revision,
    preferencesReady, preferencesError, refreshPreferences, saveOperatorGoals };
}
export type GuidancePreferences = ReturnType<typeof useGuidancePreferences>;
