// "My points" — the list of points you saved, as names + cloud ids.
//
// The point itself goes to the points database (the same one 🔗 Share uses,
// see cloud/), and only { id, name } stays in this browser: a whole point is
// ~4.4 KB against ~37 bytes here, and the localStorage quota is shared by
// every app on the origin (PLAN.md decision 10).
import { isPresetId } from './canonical';
import { readJson, writeJson } from './store';
import type { SaveResult } from './store';

export const LIBRARY_KEY = 'synesthesia_library_v1';

export interface SavedPoint {
  id: string;
  name: string;
}

function isSavedPoint(u: unknown): u is SavedPoint {
  if (typeof u !== 'object' || u === null) return false;
  const id: unknown = Reflect.get(u, 'id');
  return typeof id === 'string' && isPresetId(id) && typeof Reflect.get(u, 'name') === 'string';
}

export function loadLibrary(): SavedPoint[] {
  const parsed = readJson(LIBRARY_KEY);
  if (!Array.isArray(parsed)) return [];
  return parsed.filter(isSavedPoint).map((p) => ({ id: p.id, name: p.name }));
}

export function saveLibrary(points: SavedPoint[]): SaveResult {
  return writeJson(LIBRARY_KEY, points);
}

/** The list with `point` replacing a same-named entry, or appended. */
export function upsertPoint(points: SavedPoint[], point: SavedPoint): SavedPoint[] {
  const at = points.findIndex((p) => p.name === point.name);
  if (at < 0) return [...points, point];
  return points.map((p, i) => (i === at ? point : p));
}

/** The list without the point at `index` (a new array; bad index → a copy). */
export function removePoint(points: SavedPoint[], index: number): SavedPoint[] {
  if (!Number.isInteger(index) || index < 0 || index >= points.length) return points;
  return points.filter((_, i) => i !== index);
}

/** Next free number for the auto-name "Point N". */
export function nextPointNumber(named: { name: string }[]): number {
  let max = 0;
  for (const p of named) {
    const match = p.name.match(/^Point (\d+)$/);
    if (match) max = Math.max(max, Number(match[1]));
  }
  return max + 1;
}

/**
 * Name to offer when saving. Re-saving one of your own points offers the
 * same name (overwrite); anything else — including a built-in preset's name
 * — gets a fresh "Point N", so a saved copy is never indistinguishable from
 * the built-in it came from (users read that as "it didn't save").
 */
export function suggestPointName(current: string | undefined, named: { name: string }[]): string {
  if (current && named.some((p) => p.name === current)) return current;
  return `Point ${nextPointNumber(named)}`;
}
