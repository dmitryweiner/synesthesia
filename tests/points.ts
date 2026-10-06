// Points for tests, made by the core.
import { sanitize } from '../src/core/point';
import type { AppState } from '../src/state/types';

/** A fresh point: every formula off at its defaults, as the core makes one. */
export function defaultPoint(): AppState {
  const p = sanitize({});
  if (!p) throw new Error('the core made no point');
  return p;
}
