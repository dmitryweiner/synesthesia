// The core's session on the main thread (PLAN-CORE.md phase 4): what a
// press, a load, ⚙ Settings or the clock do is decided by syn-session; this
// module loads the wasm for the main thread and gives its JSON effects and
// view their types. main.ts gives the effects meaning (sound, picture,
// storage, the scout's workers, the status line).
import init, { WebSession, encodeToken as coreEncodeToken, parseLaunch as coreParseLaunch } from './pkg/syn_wasm.js';
import { compileCore } from './audio';
import type { AppState } from '../state/types';
import type { ScoutAnalysis, ScoutJob } from '../scout/protocol';

export { WebSession };

let ready: Promise<void> | null = null;

/** The core, instantiated on the main thread (once). */
export function initCore(): Promise<void> {
  ready ??= compileCore().then(({ module }) => init({ module_or_path: module })).then(() => undefined);
  return ready;
}

export type SessionEffect =
  | { type: 'setPoint' | 'switchTo' | 'saveLastPoint'; point: AppState }
  | { type: 'reseed' }
  | { type: 'status'; text: string }
  | { type: 'startScout'; job: ScoutJob };

export interface SessionView {
  name: string;
  pointName: string;
  steps: number;
  status: string;
  canUndo: boolean;
  undoDepth: number;
  sigma: number;
  morphing: boolean;
  playing: boolean;
  scoutedLike: number;
  scoutedDislike: number;
  scoutBusy: boolean;
}

// The core writes these; JSON.parse's `any` is taken at its word here, at
// the boundary, rather than re-validated on every morph step.
export function parseEffects(json: string): SessionEffect[] {
  const fx: SessionEffect[] = JSON.parse(json);
  return fx;
}

export function viewOf(session: WebSession): SessionView {
  const v: SessionView = JSON.parse(session.view());
  return v;
}

export function pointOf(json: string): AppState {
  const p: AppState = JSON.parse(json);
  return p;
}

export function scoutParentOf(session: WebSession): ScoutAnalysis | null {
  const json = session.scoutParent();
  if (json === undefined) return null;
  const a: ScoutAnalysis = JSON.parse(json);
  return a;
}

/** What a link asks to open — the core's parse_launch, in the web app's
 *  order: a stored point, then a `#s=` token (sanitized, so an old partial
 *  point opens with the defaults filled in), then `?preset=N`. */
export type CoreLaunch =
  | { kind: 'presetId'; id: string }
  | { kind: 'point'; point: AppState }
  | { kind: 'preset'; index: number }
  | { kind: 'none' };

export function parseLaunch(href: string): CoreLaunch {
  const l: CoreLaunch = JSON.parse(coreParseLaunch(href));
  return l;
}

/** The long link's `#s=` payload for a point. */
export function encodeToken(state: Readonly<AppState>): string {
  return coreEncodeToken(JSON.stringify(state));
}
