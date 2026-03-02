import type { PersistedState } from "../types";

const STORAGE_KEY = "leben-in-deutschland-trainer.v1";

export function loadState(): PersistedState | null {
  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as PersistedState;
    if (!parsed.progressById || !parsed.settings) {
      console.warn("Ignoring malformed persisted state.");
      return null;
    }
    return parsed;
  } catch (error) {
    console.warn("Could not parse persisted state.", error);
    return null;
  }
}

export function saveState(state: PersistedState): void {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}
