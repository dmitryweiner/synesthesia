// ⚙ Settings' model from the core (PLAN-CORE.md phase 6, C13): the page's
// data (syn-wasm settingsPageJson — FX modules, filter rows per type,
// couplings, scales, LFO shape labels, route targets), the schema's
// formulas and cards, the effect presets, and the page's rules. Read
// lazily: the wasm is instantiated in boot(), after this module loads.
import {
  applyFxPreset as coreApplyFxPreset, canAddRoute as coreCanAddRoute, canEnableFormula as coreCanEnableFormula,
  fxPresetsJson, isTargetOn as coreIsTargetOn, modulatedKeys as coreModulatedKeys, newRoute as coreNewRoute,
  routeDomain as coreRouteDomain, samePoint as coreSamePoint, schemaJson, settingsPageJson,
  targetExp as coreTargetExp, vowelLabel as coreVowelLabel,
} from './pkg/syn_wasm.js';
import type { CardDef, FormulaDef, FxState, ModRoute } from '../state/types';
import type { AppState } from '../state/types';

export interface PageControl { k: string; name: string; min: number; max: number; step: number; exp?: boolean }
export interface PageChoice { k: string; name: string; options: { value: string; label: string; group?: string }[] }
export interface PageFxModule { on: string; title: string; tag: string; choices: PageChoice[]; sliders: PageControl[] }
export interface PageFilterControls { q: boolean; gain: boolean; vowel: boolean; comb: boolean; freqLabel: string; qLabel: string }
export interface PageCoupling extends PageControl { kind: 'offset' | 'effect' }
export interface PageScale { min: number; max: number; exp?: boolean; step?: number; k?: string; name?: string }
export interface PageTargetGroup { id: string; title: string; params: { k: string; name: string; exp: boolean }[] }

export interface SettingsPageModel {
  fxModules: PageFxModule[];
  filterControls: Record<string, PageFilterControls>;
  vowels: string[];
  couplingControls: PageCoupling[];
  lfoShapeLabels: Record<string, string>;
  lfoRate: PageScale;
  lfoPhase: PageScale;
  routeDepth: PageScale;
  newRouteDepth: number;
  targetGroups: { sound: PageTargetGroup[]; picture: PageTargetGroup[] };
}

/** The parts of the core's schema the page reads. */
export interface CoreSchema {
  formulas: FormulaDef[];
  maxEnabledFormulas: number;
  cards: CardDef[];
  alwaysOnCardIds: string[];
  lfoShapes: string[];
  lfoCount: number;
  routeSlots: number;
  filterTypes: string[];
  chorusModes: string[];
  fxOnKeys: string[];
  fxModParams: string[];
}

export interface FxPreset { name: string; group: string; fx: Partial<FxState> }

// The core writes these; its JSON is taken at its word at the boundary.
let pageCache: SettingsPageModel | null = null;
export function pageModel(): SettingsPageModel {
  if (!pageCache) {
    const p: SettingsPageModel = JSON.parse(settingsPageJson());
    pageCache = p;
  }
  return pageCache;
}

let schemaCache: CoreSchema | null = null;
export function coreSchema(): CoreSchema {
  if (!schemaCache) {
    const s: CoreSchema = JSON.parse(schemaJson());
    schemaCache = s;
  }
  return schemaCache;
}

let presetsCache: FxPreset[] | null = null;
export function fxPresets(): FxPreset[] {
  if (!presetsCache) {
    const p: FxPreset[] = JSON.parse(fxPresetsJson());
    presetsCache = p;
  }
  return presetsCache;
}

export function applyFxPreset(fx: Readonly<FxState>, index: number): FxState {
  const out: FxState = JSON.parse(coreApplyFxPreset(JSON.stringify(fx), index));
  return out;
}

const json = (s: Readonly<AppState>): string => JSON.stringify(s);

export const canEnableFormula = (s: Readonly<AppState>, id: string): boolean => coreCanEnableFormula(json(s), id);
export const isTargetOn = (s: Readonly<AppState>, target: string): boolean => coreIsTargetOn(json(s), target);
export const canAddRoute = (s: Readonly<AppState>): boolean => coreCanAddRoute(json(s));
export const targetExp = (target: string, param: string): boolean => coreTargetExp(target, param);
export const vowelLabel = (v: number): string => coreVowelLabel(v);
export const samePoint = (a: Readonly<AppState>, b: Readonly<AppState>): boolean => coreSamePoint(json(a), json(b));

export type Domain = 'sound' | 'picture';
export function routeDomain(target: string): Domain {
  return coreRouteDomain(target) === 'picture' ? 'picture' : 'sound';
}

export function newRoute(s: Readonly<AppState>, domain: Domain): ModRoute {
  const r: ModRoute & { exp?: boolean } = JSON.parse(coreNewRoute(json(s), domain));
  if (!r.exp) delete r.exp;
  return r;
}

export function modulatedKeys(routes: readonly ModRoute[]): Set<string> {
  const keys: string[] = JSON.parse(coreModulatedKeys(JSON.stringify(routes.map((r) => ({ ...r, exp: r.exp === true })))));
  return new Set(keys);
}
