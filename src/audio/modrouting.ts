// Pure assembly of the modulation payload for one worklet node (routes
// filtered by target + ranges from the schema) and control-rate FX
// modulation. Split out of engine.ts so it's testable without Web Audio.
import { modulatedParam } from '../dsp/mod';
import type { LfoDef, ModRoute, ModState, ParamRanges } from '../dsp/mod';
import type { FxState } from '../schema/audio';
import { FX_PARAM_RANGES, isFxModParam } from '../schema/audio';

export interface ModPayload {
  lfos: LfoDef[];
  routes: ModRoute[];
  ranges: ParamRanges;
}

// Minimal shape of a formula's schema entry needed to look up ranges.
export interface FormulaRanges {
  id: string;
  sliders: readonly { k: string; min: number; max: number }[];
}

export function buildModPayload(
  mod: ModState | null,
  formula: string,
  formulas: readonly FormulaRanges[],
): ModPayload {
  if (!mod) return { lfos: [], routes: [], ranges: {} };
  const routes = mod.routes.filter((r) => r.target === formula);
  const ranges: ParamRanges = {};
  const def = formulas.find((f) => f.id === formula);
  if (def) {
    for (const r of routes) {
      const s = def.sliders.find((sl) => sl.k === r.param);
      if (s) ranges[r.param] = [s.min, s.max];
    }
  }
  return { lfos: mod.lfos, routes, ranges };
}

// Effective FxState at time t: base with modulated allowlisted fields laid
// over it (routes with target === 'fx'; several on one field add up). Pure.
export function modulateFx(
  base: FxState,
  routes: readonly ModRoute[],
  lfos: readonly LfoDef[],
  t: number,
): FxState {
  const eff: FxState = { ...base };
  for (const r of routes) {
    if (r.target !== 'fx' || !isFxModParam(r.param)) continue;
    eff[r.param] = modulatedParam(r.param, base[r.param], FX_PARAM_RANGES[r.param], routes, lfos, t, 'fx');
  }
  return eff;
}
