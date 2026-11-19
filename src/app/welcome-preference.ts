import type {UiPreferencesStorage} from './ui-preferences';

// This remembers only the choice to enter locally, never account state or credentials.
export const GUEST_MODE_KEY = 'virgostars.desktop.guest-mode.v1';
export function hasChosenGuestMode(storage: UiPreferencesStorage | null): boolean {
  try { return storage?.getItem(GUEST_MODE_KEY) === 'chosen'; }
  catch { return false; }
}
export function rememberGuestMode(storage: UiPreferencesStorage | null): boolean {
  try { if (!storage) return false; storage.setItem(GUEST_MODE_KEY, 'chosen'); return true; }
  catch { return false; }
}

/** A successful sign-in supersedes an earlier choice to remain a guest. */
export function clearGuestMode(storage: UiPreferencesStorage | null): boolean {
  try { if (!storage) return false; storage.setItem(GUEST_MODE_KEY, 'connected'); return true; }
  catch { return false; }
}
