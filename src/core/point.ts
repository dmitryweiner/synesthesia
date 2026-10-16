// A point from outside (a stored point, localStorage, an old link) made safe,
// and the built-in presets — the core's (syn_core::point, syn_core::state),
// through the main thread's wasm (PLAN-CORE.md C2).
import { pointId, presetNames, presetStateJson, sanitizePoint } from './pkg/syn_wasm.js';
import type { AppState } from '../state/types';

/** The complete point `u` sanitizes to (every value clamped, malformed
 *  parts dropped, missing ones at their defaults), or null when it is not a
 *  point at all. */
export function sanitize(u: unknown): AppState | null {
  let json: string;
  try {
    json = JSON.stringify(u);
  } catch {
    return null;
  }
  const canonical = sanitizePoint(json ?? 'null');
  if (canonical === undefined) return null;
  const point: AppState = JSON.parse(canonical);
  return point;
}

/** The id the points Worker stores `u` under — the id of its sanitized,
 *  canonical form — or null when it is not a point. */
export function pointIdOf(u: unknown): string | null {
  let json: string;
  try {
    json = JSON.stringify(u);
  } catch {
    return null;
  }
  const canonical = sanitizePoint(json ?? 'null');
  return canonical === undefined ? null : pointId(canonical);
}

export interface Preset { name: string; state: AppState }

let presetCache: Preset[] | null = null;
/** The built-in presets, in the core's order (?preset=N is an index here). */
export function builtInPresets(): Preset[] {
  presetCache ??= presetNames().map((name, i) => {
    const state: AppState = JSON.parse(presetStateJson(i) ?? '{}');
    return { name, state };
  });
  return presetCache;
}

/** The point everything opens on when nothing else asks. */
export const DEFAULT_PRESET_INDEX = 0;

/** Ten letters and digits: the shape of a stored point's id. */
export function isPointId(s: string): boolean {
  return /^[0-9A-Za-z]{10}$/.test(s);
}
