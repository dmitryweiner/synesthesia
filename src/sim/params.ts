// Pure Gray-Scott parameter types + defaults, kept out of engine.ts (which
// owns WebGL) so this stays importable from vitest. Slider ranges live in
// schema/visual.ts; this module reads a card's flat param record into the
// typed shape the engine wants.

export interface ReactionParams {
  feed: number;
  kill: number;
  diffU: number;
  diffV: number;
  speed: number;
}

// pmneila-style Gray-Scott defaults: coral/mitosis growth, reliably alive.
export const DEFAULT_REACTION_PARAMS: Readonly<ReactionParams> = {
  feed: 0.037,
  kill: 0.06,
  diffU: 0.2097,
  diffV: 0.105,
  speed: 10,
};

export function reactionParamsFromCard(params: Readonly<Record<string, number>>): ReactionParams {
  return {
    feed: params.feed ?? DEFAULT_REACTION_PARAMS.feed,
    kill: params.kill ?? DEFAULT_REACTION_PARAMS.kill,
    diffU: params.diffU ?? DEFAULT_REACTION_PARAMS.diffU,
    diffV: params.diffV ?? DEFAULT_REACTION_PARAMS.diffV,
    speed: params.speed ?? DEFAULT_REACTION_PARAMS.speed,
  };
}

export interface FieldVariationParams {
  feedVarAmount: number;
  feedVarScale: number;
  feedVarWarp: number;
  killVarAmount: number;
  killVarScale: number;
  killVarWarp: number;
}

// All-zero = uniform feed/kill, no perturbation (an exact no-op).
export const ZERO_FIELD_VARIATION: Readonly<FieldVariationParams> = {
  feedVarAmount: 0, feedVarScale: 1, feedVarWarp: 0,
  killVarAmount: 0, killVarScale: 1, killVarWarp: 0,
};

export function fieldVariationParamsFromCard(params: Readonly<Record<string, number>>): FieldVariationParams {
  return {
    feedVarAmount: params.feedVarAmount ?? ZERO_FIELD_VARIATION.feedVarAmount,
    feedVarScale: params.feedVarScale ?? ZERO_FIELD_VARIATION.feedVarScale,
    feedVarWarp: params.feedVarWarp ?? ZERO_FIELD_VARIATION.feedVarWarp,
    killVarAmount: params.killVarAmount ?? ZERO_FIELD_VARIATION.killVarAmount,
    killVarScale: params.killVarScale ?? ZERO_FIELD_VARIATION.killVarScale,
    killVarWarp: params.killVarWarp ?? ZERO_FIELD_VARIATION.killVarWarp,
  };
}

export interface FlowParams {
  curlStrength: number;
  curlScale: number;
  driftX: number;
  driftY: number;
  advectAmount: number;
  evolveRate: number;
}

// No flow at all (curlScale=1 avoids a degenerate noise sample).
export const ZERO_FLOW: Readonly<FlowParams> = {
  curlStrength: 0, curlScale: 1, driftX: 0, driftY: 0, advectAmount: 0, evolveRate: 0,
};

export function flowParamsFromCard(params: Readonly<Record<string, number>>): FlowParams {
  return {
    curlStrength: params.curlStrength ?? ZERO_FLOW.curlStrength,
    curlScale: params.curlScale ?? ZERO_FLOW.curlScale,
    driftX: params.driftX ?? ZERO_FLOW.driftX,
    driftY: params.driftY ?? ZERO_FLOW.driftY,
    advectAmount: params.advectAmount ?? ZERO_FLOW.advectAmount,
    evolveRate: params.evolveRate ?? ZERO_FLOW.evolveRate,
  };
}

export interface PearsonPoint {
  name: string;
  feed: number;
  kill: number;
}

// Approximate, commonly-cited Gray-Scott (feed, kill) coordinates for named
// pattern families (folklore from open RD demos, traceable to Pearson
// 1993). Aesthetic starting points, not scientific constants.
export const PEARSON_POINTS: readonly PearsonPoint[] = [
  { name: 'Spots', feed: 0.025, kill: 0.06 },
  { name: 'Stripes', feed: 0.03, kill: 0.057 },
  { name: 'Maze', feed: 0.029, kill: 0.057 },
  { name: 'Coral', feed: 0.0545, kill: 0.062 },
  { name: 'Mitosis', feed: 0.0367, kill: 0.0649 },
  { name: 'Worms', feed: 0.078, kill: 0.061 },
];
