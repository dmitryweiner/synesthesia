// Audio → image coupling (pure): live features from the analyser, scaled by
// the coupling genes, offset visual card params every frame. Cyclic params
// (palette phase, light angle) wrap; the rest clamp to their slider range.
import type { AudioFeatures } from './audio/features';
import type { CouplingKey } from './state/schema';
import { cardDef } from './schema/visual';

export interface CouplingDef {
  key: CouplingKey;
  label: string;
  card: string;
  param: string;
  feature: keyof AudioFeatures;
  /** Offset at feature=1 and coupling=1, in the param's real units. */
  scale: number;
  /** Feature is used as (value − 0.5), so its midpoint is neutral. */
  centered?: boolean;
  /** Wrap around the slider range instead of clamping. */
  wrap?: boolean;
}

export const COUPLING_DEFS: readonly CouplingDef[] = [
  { key: 'loudToFlow', label: 'Loudness → advection', card: 'flow', param: 'advectAmount', feature: 'loudness', scale: 0.5 },
  { key: 'loudToCurl', label: 'Loudness → curl', card: 'flow', param: 'curlStrength', feature: 'loudness', scale: 0.015 },
  { key: 'loudToGloss', label: 'Loudness → gloss', card: 'palette', param: 'gloss', feature: 'loudness', scale: 0.6 },
  { key: 'brightToShift', label: 'Brightness → hue', card: 'palette', param: 'shift', feature: 'brightness', scale: 0.5, centered: true, wrap: true },
  { key: 'onsetToLight', label: 'Onsets → light angle', card: 'palette', param: 'lightAngle', feature: 'onset', scale: 1.5, wrap: true },
];

function range(card: string, param: string): readonly [number, number] {
  const s = cardDef(card)?.sliders.find((x) => x.k === param);
  return s ? [s.min, s.max] : [-Infinity, Infinity];
}

const RANGES: ReadonlyMap<CouplingKey, readonly [number, number]> = new Map(
  COUPLING_DEFS.map((d) => [d.key, range(d.card, d.param)]),
);

/** Returns a cloned card-params map with coupling offsets applied. */
export function applyCoupling(
  cards: Readonly<Record<string, Readonly<Record<string, number>>>>,
  features: Readonly<AudioFeatures>,
  coupling: Readonly<Record<string, number>>,
): Record<string, Record<string, number>> {
  const out: Record<string, Record<string, number>> = {};
  for (const [id, params] of Object.entries(cards)) out[id] = { ...params };
  for (const d of COUPLING_DEFS) {
    const c = coupling[d.key] ?? 0;
    let f = features[d.feature];
    if (d.centered) f -= 0.5;
    const delta = c * f * d.scale;
    if (delta === 0) continue;
    const target = out[d.card];
    if (!target || typeof target[d.param] !== 'number') continue;
    const [lo, hi] = RANGES.get(d.key) ?? [-Infinity, Infinity];
    const v = target[d.param] + delta;
    if (d.wrap && Number.isFinite(lo) && Number.isFinite(hi)) {
      const span = hi - lo;
      target[d.param] = lo + (((v - lo) % span) + span) % span;
    } else {
      target[d.param] = Math.max(lo, Math.min(hi, v));
    }
  }
  return out;
}
