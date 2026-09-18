// Visual parameter schema (ported from chromaflux's formulas.ts, trimmed to
// Reaction / Field variation / Flow / Palette). Slider `value` is the single
// source of truth for defaults.
import type { SliderDef } from './audio';

export interface SelectOption {
  v: number;
  label: string;
}

export interface SelectDef {
  k: string;
  name: string;
  options: SelectOption[];
  value: number;
}

export interface CardDef<Id extends string = string> {
  id: Id;
  title: string;
  tag: string;
  desc: string;
  selects?: SelectDef[];
  sliders: SliderDef[];
}

export type CardId = 'reaction' | 'fieldVariation' | 'flow' | 'palette';

export const REACTION_CARD: CardDef<'reaction'> = {
  id: 'reaction',
  title: 'Reaction',
  tag: 'Gray–Scott',
  desc: 'du/dt = Du·∇²u − uv² + f(1−u), dv/dt = Dv·∇²v + uv² − (f+k)v — the core growth engine.',
  sliders: [
    { k: 'feed', name: 'Feed', min: 0.01, max: 0.09, step: 0.0005, value: 0.037 },
    { k: 'kill', name: 'Kill', min: 0.03, max: 0.075, step: 0.0005, value: 0.06 },
    { k: 'diffU', name: 'Diff U', min: 0.05, max: 0.4, step: 0.001, value: 0.2097 },
    { k: 'diffV', name: 'Diff V', min: 0.02, max: 0.2, step: 0.001, value: 0.105 },
    { k: 'speed', name: 'Speed', min: 1, max: 40, step: 1, value: 10 },
  ],
};

export const FIELD_VARIATION_CARD: CardDef<'fieldVariation'> = {
  id: 'fieldVariation',
  title: 'Field variation',
  tag: 'domain warp',
  desc: 'Perturbs Feed/Kill spatially with two warped fbm layers — different regions land in different pattern families at once.',
  sliders: [
    { k: 'feedVarAmount', name: 'Feed amount', min: 0, max: 0.03, step: 0.0005, value: 0.015 },
    { k: 'feedVarScale', name: 'Feed scale', min: 1, max: 12, step: 0.5, value: 4, exp: true },
    { k: 'feedVarWarp', name: 'Feed warp', min: 0, max: 3, step: 0.05, value: 1 },
    { k: 'killVarAmount', name: 'Kill amount', min: 0, max: 0.015, step: 0.0005, value: 0.008 },
    { k: 'killVarScale', name: 'Kill scale', min: 1, max: 12, step: 0.5, value: 5, exp: true },
    { k: 'killVarWarp', name: 'Kill warp', min: 0, max: 3, step: 0.05, value: 1 },
  ],
};

export const FLOW_CARD: CardDef<'flow'> = {
  id: 'flow',
  title: 'Flow',
  tag: 'advection',
  desc: 'Advects the field through a curl-noise velocity plus a constant drift ("gravity") — folded layers and drips.',
  sliders: [
    { k: 'curlStrength', name: 'Curl strength', min: 0, max: 0.03, step: 0.0005, value: 0.01 },
    { k: 'curlScale', name: 'Curl scale', min: 1, max: 12, step: 0.5, value: 3, exp: true },
    { k: 'driftX', name: 'Drift X', min: -0.02, max: 0.02, step: 0.0005, value: 0 },
    { k: 'driftY', name: 'Drift Y (+down)', min: -0.02, max: 0.02, step: 0.0005, value: 0 },
    { k: 'advectAmount', name: 'Advect amount', min: 0, max: 1, step: 0.01, value: 0.35 },
    { k: 'evolveRate', name: 'Evolve rate', min: 0, max: 0.05, step: 0.001, value: 0.01 },
  ],
};

// Order must match palette.ts's BUILTIN_PALETTES.
export const PALETTE_NAMES = ['Marble', 'Glaze', 'Verdigris', 'Ink', 'Basalt'] as const;

export const PALETTE_CARD: CardDef<'palette'> = {
  id: 'palette',
  title: 'Palette',
  tag: 'cosine',
  desc: 'Maps the field to color with an iq-style cosine gradient, plus bump-mapped relief for a stone/glaze sheen.',
  selects: [
    {
      k: 'paletteId',
      name: 'Palette',
      value: 0,
      options: PALETTE_NAMES.map((label, v) => ({ v, label })),
    },
  ],
  sliders: [
    { k: 'shift', name: 'Shift', min: 0, max: 1, step: 0.01, value: 0 },
    { k: 'contrast', name: 'Contrast', min: 0.2, max: 2, step: 0.01, value: 1 },
    { k: 'bands', name: 'Bands', min: 1, max: 8, step: 1, value: 1 },
    { k: 'relief', name: 'Relief', min: 0, max: 3, step: 0.05, value: 0.8 },
    { k: 'lightAngle', name: 'Light angle', min: 0, max: 6.283, step: 0.05, value: 2.0 },
    { k: 'gloss', name: 'Gloss', min: 0, max: 1, step: 0.02, value: 0.3 },
  ],
};

// Reaction/Palette are always on (no meaningful "off"); Field variation
// and Flow contribute every frame and can meaningfully no-op.
export const ALWAYS_ON_CARD_IDS: readonly CardId[] = ['reaction', 'palette'];
export const DEFAULT_OFF_CARD_IDS: readonly CardId[] = ['fieldVariation', 'flow'];

export const CARDS: readonly CardDef<CardId>[] = [
  REACTION_CARD, FIELD_VARIATION_CARD, FLOW_CARD, PALETTE_CARD,
];

export function isCardId(id: string): id is CardId {
  return CARDS.some((c) => c.id === id);
}

export function cardDef(id: string): CardDef<CardId> | undefined {
  return CARDS.find((c) => c.id === id);
}

/** slider key -> [min, max] (selects aren't modulation targets). */
export function cardSliderRanges(card: CardDef): Record<string, readonly [number, number]> {
  const out: Record<string, readonly [number, number]> = {};
  for (const s of card.sliders) out[s.k] = [s.min, s.max];
  return out;
}

/** Whether (cardId, param) names a real slider. */
export function isVisualModTarget(cardId: string, param: string): boolean {
  const card = cardDef(cardId);
  return card ? card.sliders.some((s) => s.k === param) : false;
}
