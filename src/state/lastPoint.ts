// The current point survives a reload through localStorage (the address bar
// no longer carries it — PLAN.md decision 9). Tolerant: anything unreadable
// is treated as "no last point".
import type { AppState } from './schema';
import { sanitizeState, stateToAppState } from './schema';

export const LAST_POINT_KEY = 'synesthesia_last_point_v1';

export function saveLastPoint(state: AppState): void {
  try {
    localStorage.setItem(LAST_POINT_KEY, JSON.stringify(state));
  } catch {
    // private mode / quota: the point just won't survive a reload
  }
}

export function loadLastPoint(): AppState | null {
  try {
    const raw = localStorage.getItem(LAST_POINT_KEY);
    if (!raw) return null;
    const partial = sanitizeState(JSON.parse(raw));
    return partial ? stateToAppState(partial) : null;
  } catch {
    return null;
  }
}
