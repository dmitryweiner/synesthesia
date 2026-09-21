// User-saved points in localStorage.
import type { AppState } from './schema';

export const USER_PRESETS_KEY = 'synesthesia_user_presets_v1';

export interface UserPreset {
  name: string;
  state: AppState;
}

function isUserPreset(u: unknown): u is UserPreset {
  return typeof u === 'object' && u !== null
    && typeof Reflect.get(u, 'name') === 'string'
    && typeof Reflect.get(u, 'state') === 'object';
}

export function loadUserPresets(): UserPreset[] {
  try {
    const raw = localStorage.getItem(USER_PRESETS_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isUserPreset);
  } catch {
    return [];
  }
}

export function saveUserPresets(presets: UserPreset[]): void {
  localStorage.setItem(USER_PRESETS_KEY, JSON.stringify(presets));
}

/** Next free number for the auto-name "Point N". */
export function nextPresetNumber(presets: UserPreset[]): number {
  let maxNum = 0;
  for (const p of presets) {
    const match = p.name.match(/^Point (\d+)$/);
    if (match) maxNum = Math.max(maxNum, Number(match[1]));
  }
  return maxNum + 1;
}

/**
 * Name to offer when saving. Re-saving one of the user's own points offers
 * the same name (overwrite); anything else — including a built-in preset's
 * name — gets a fresh "Point N", so a saved copy is never indistinguishable
 * from the built-in it came from (users read that as "it didn't save").
 */
export function suggestPointName(current: string | undefined, presets: UserPreset[]): string {
  if (current && presets.some((p) => p.name === current)) return current;
  return `Point ${nextPresetNumber(presets)}`;
}
