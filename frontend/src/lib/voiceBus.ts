// voiceBus.ts — lets any component (e.g. the guidance bar) drive the ChatDock's
// "Listen to OR" wake-word voice loop and reflect its live state, without prop
// drilling. ChatDock owns the listener + the answer/TTS pipeline and registers a
// control here; other components toggle it. Shared output state includes
// guidance read-aloud, Guardian warnings and chat, with actual playback phases.

import { useSyncExternalStore } from "react";
import type { SpeechPhase } from "./speech";

export interface VoiceState {
  active: boolean; // wake-word mic loop is on
  speaking: boolean; // any guidance, alert or answer is currently audible
  outputPhase?: SpeechPhase;
  supported: boolean; // browser supports the Web Speech API
}

export interface VoiceControl {
  toggle: () => void;
  start: () => void;
  stop: () => void;
  /** Suspend capture while TTS plays (so the app doesn't hear itself). */
  pause?: () => void;
  /** Resume capture after pause(), if the loop is still active. */
  resume?: () => void;
}

let control: VoiceControl | null = null;
let state: VoiceState = { active: false, speaking: false, supported: false };
const subs = new Set<() => void>();

/** ChatDock registers its listener controls here (null on unmount). */
export function registerVoiceControl(c: VoiceControl | null): void {
  control = c;
}

/** ChatDock pushes state changes; deduped so subscribers only re-render on change. */
export function publishVoiceState(s: VoiceState): void {
  if (
    s.active === state.active &&
    s.speaking === state.speaking &&
    s.outputPhase === state.outputPhase &&
    s.supported === state.supported
  )
    return;
  state = s;
  subs.forEach((fn) => fn());
}

function subscribe(fn: () => void): () => void {
  subs.add(fn);
  return () => {
    subs.delete(fn);
  };
}
function getSnapshot(): VoiceState {
  return state;
}

export function voiceToggle(): void {
  control?.toggle();
}
export function voiceStart(): void {
  control?.start();
}
export function voiceStop(): void {
  control?.stop();
}
export function voicePause(): void {
  control?.pause?.();
}
export function voiceResume(): void {
  control?.resume?.();
}

/** Subscribe to the shared voice state from any component. */
export function useVoiceState(): VoiceState {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
