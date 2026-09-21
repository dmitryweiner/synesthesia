// Points saved by the old build: the whole AppState per point, in
// localStorage. Kept only to migrate them into the library (state/library.ts)
// — they are uploaded on boot and this key is then dropped, which also frees
// ~4.4 KB per point of the origin's shared quota.
import type { AppState } from './schema';
import { readJson, removeKey, writeJson } from './store';
import type { SaveResult } from './store';

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
  const parsed = readJson(USER_PRESETS_KEY);
  if (!Array.isArray(parsed)) return [];
  return parsed.filter(isUserPreset);
}

/** Only for dropping one that couldn't be migrated yet; nothing new is written here. */
export function saveUserPresets(presets: UserPreset[]): SaveResult {
  return writeJson(USER_PRESETS_KEY, presets);
}

export function clearUserPresets(): void {
  removeKey(USER_PRESETS_KEY);
}
