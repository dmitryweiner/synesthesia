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

export type SaveResult = { ok: true } | { ok: false; reason: 'full' | 'blocked' };

/**
 * Saves and reads back to confirm. Browsers can refuse quietly: the
 * localStorage quota is shared by every site on the origin (all of
 * dmitryweiner.github.io here), and private/blocked storage can accept a
 * write that vanishes. A silent failure looks exactly like "saving is
 * broken", so the caller must be able to say so.
 */
export function saveUserPresets(presets: UserPreset[]): SaveResult {
  const json = JSON.stringify(presets);
  try {
    localStorage.setItem(USER_PRESETS_KEY, json);
  } catch (err) {
    const name = err instanceof DOMException ? err.name : '';
    return { ok: false, reason: name === 'QuotaExceededError' || name === 'NS_ERROR_DOM_QUOTA_REACHED' ? 'full' : 'blocked' };
  }
  try {
    if (localStorage.getItem(USER_PRESETS_KEY) !== json) return { ok: false, reason: 'blocked' };
  } catch {
    return { ok: false, reason: 'blocked' };
  }
  return { ok: true };
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

/** The list without the point at `index` (a new array; bad index → unchanged). */
export function removeUserPreset(presets: UserPreset[], index: number): UserPreset[] {
  if (!Number.isInteger(index) || index < 0 || index >= presets.length) return presets;
  return presets.filter((_, i) => i !== index);
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
