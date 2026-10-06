// The ⚙ Settings page's pure side (no DOM). Its data and its rules are the
// core's (PLAN-CORE.md C13: src/core/settings.ts → syn_core::settings_page,
// whose tests hold the guarantee that everything the page lets you set
// survives the genome); what stays here is the page's own presentation —
// how a slider maps to a value and how a value reads.
import type { ModRoute } from '../state/types';
import type { FxState } from '../state/types';
import type { ChorusMode, FilterType } from '../state/types';
import { coreSchema } from '../core/settings';
import {
  pageModel, type Domain, type PageControl, type PageCoupling, type PageFilterControls, type PageFxModule,
  type PageScale, type PageTargetGroup,
} from '../core/settings';

export {
  applyFxPreset, canAddRoute, canEnableFormula, coreSchema, fxPresets, isTargetOn, modulatedKeys, newRoute,
  routeDomain, samePoint, targetExp, vowelLabel,
} from '../core/settings';
export type { Domain, FxPreset } from '../core/settings';
export type { ModRoute };

// ---------------------------------------------------------------------------
// Slider scales

export interface Scale {
  min: number;
  max: number;
  step?: number;
  /** Frequency-like: the slider moves in octaves. */
  exp?: boolean;
}

/** Positions of a logarithmic slider (1000 → 8 cents a step across 20–2000 Hz). */
export const LOG_STEPS = 1000;

export function isLogScale(s: Scale): boolean {
  return s.exp === true && s.min > 0 && s.max > s.min;
}

function clamp(x: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, x));
}

/** min/max/step for the <input type="range">. */
export function rangeAttrs(s: Scale): { min: number; max: number; step: number } {
  if (isLogScale(s)) return { min: 0, max: LOG_STEPS, step: 1 };
  return { min: s.min, max: s.max, step: s.step ?? (s.max - s.min) / LOG_STEPS };
}

export function toSliderPos(s: Scale, v: number): number {
  if (!isLogScale(s)) return clamp(v, s.min, s.max);
  const t = Math.log(clamp(v, s.min, s.max) / s.min) / Math.log(s.max / s.min);
  return Math.round(t * LOG_STEPS);
}

/** Value at a slider position. Whole-step exp values come out whole, as the genome decodes them. */
export function fromSliderPos(s: Scale, pos: number): number {
  if (!isLogScale(s)) return clamp(pos, s.min, s.max);
  const v = s.min * Math.pow(s.max / s.min, clamp(pos, 0, LOG_STEPS) / LOG_STEPS);
  return s.step !== undefined && s.step >= 1 ? clamp(Math.round(v), s.min, s.max) : v;
}

/** A slider's readout: as many decimals as its step has; without a step, ~3 significant digits. */
export function formatValue(v: number, step?: number): string {
  if (!Number.isFinite(v)) return '—';
  if (step !== undefined && step > 0) {
    const decimals = clamp(Math.ceil(-Math.log10(step) - 1e-9), 0, 4);
    return v.toFixed(decimals);
  }
  const a = Math.abs(v);
  if (a >= 100) return v.toFixed(0);
  if (a >= 10) return v.toFixed(1);
  if (a >= 1) return v.toFixed(2);
  return String(Number(v.toPrecision(3)));
}

// ---------------------------------------------------------------------------
// The core's page model, read when the page is built

export type FxNumKey = string;
export type FxChoiceKey = 'filterType' | 'chorusMode' | 'phaserStages';
export type ControlSpec = PageControl;
export type FxCardSpec = PageFxModule;
export type CouplingControl = PageCoupling;
export type TargetGroup = PageTargetGroup;
export const FX_TARGET = 'fx';

/** One card per effect module, in the order the chain runs. */
export const fxCards = (): FxCardSpec[] => pageModel().fxModules;
export const couplingControls = (): CouplingControl[] => pageModel().couplingControls;
export const lfoShapeLabels = (): Record<string, string> => pageModel().lfoShapeLabels;
export const lfoRateScale = (): Scale => pageModel().lfoRate;
export const lfoPhaseScale = (): ControlSpec => control(pageModel().lfoPhase);
export const routeDepthScale = (): ControlSpec => control(pageModel().routeDepth);
export const targetGroups = (domain: Domain): TargetGroup[] => pageModel().targetGroups[domain];

function control(s: PageScale): ControlSpec {
  return { k: s.k ?? '', name: s.name ?? '', min: s.min, max: s.max, step: s.step ?? (s.max - s.min) / LOG_STEPS, exp: s.exp };
}

/** Which filter rows a type uses, and what its frequency/Q mean. */
export function filterControls(type: string): PageFilterControls {
  return pageModel().filterControls[type] ?? pageModel().filterControls.lowpass;
}

export function fxChoiceValue(state: Readonly<FxState>, k: FxChoiceKey): string {
  return String(state[k]);
}

/** Sets a choice from a <select>'s value; anything the engine doesn't offer is ignored. */
export function setFxChoice(state: FxState, k: FxChoiceKey, value: string): void {
  const choice = pageModel().fxModules.flatMap((m) => m.choices).find((c) => c.k === k);
  if (!choice?.options.some((o) => o.value === value)) return;
  if (k === 'phaserStages') state.phaserStages = Number(value);
  else if (k === 'filterType' && isFilterType(value)) state.filterType = value;
  else if (k === 'chorusMode' && isChorusMode(value)) state.chorusMode = value;
}

function isFilterType(v: string): v is FilterType {
  return coreSchema().filterTypes.includes(v);
}
function isChorusMode(v: string): v is ChorusMode {
  return coreSchema().chorusModes.includes(v);
}

// The core names fields by string; these read and write them only where the
// point has a field of that kind, so a name the page does not know is a no-op.
export function fxNumber(fx: Readonly<FxState>, k: string): number {
  const v: unknown = Reflect.get(fx, k);
  return typeof v === 'number' ? v : NaN;
}
export function setFxNumber(fx: FxState, k: string, v: number): void {
  if (typeof Reflect.get(fx, k) === 'number') Reflect.set(fx, k, v);
}
export function fxFlag(fx: Readonly<FxState>, k: string): boolean {
  return Reflect.get(fx, k) === true;
}
export function setFxFlag(fx: FxState, k: string, on: boolean): void {
  if (typeof Reflect.get(fx, k) === 'boolean') Reflect.set(fx, k, on);
}
export function couplingValue(c: Readonly<Record<string, number>>, k: string): number {
  return c[k] ?? 0;
}
