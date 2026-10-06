// The core's picture driver on the main thread (PLAN-CORE.md phase 5): what
// each frame of the picture needs (syn-wasm WebPicture), typed for the
// WebGL2 renderer (src/sim/engine.ts) and the CPU fallback. The core decides
// what a hit or a finger becomes, which ripples live, the LFO clock, the
// noise's drift and the quality rung; the renderer only draws.
import {
  WebPicture, backingStore, maxRipples, qualityLadder, simGrid,
} from './pkg/syn_wasm.js';

export { WebPicture };

export interface PictureFrame {
  time: number;
  evolveT: number;
  /** [x, y, radius, amount] — inject these first, in order. */
  injects: [number, number, number, number][];
  /** [x, y, age, amp], newest last. */
  ripples: [number, number, number, number][];
  reaction: { feed: number; kill: number; diffU: number; diffV: number; substeps: number };
  fieldVariation: {
    feedAmount: number; feedScale: number; feedWarp: number;
    killAmount: number; killScale: number; killWarp: number;
    /** False: the pass would draw zeros — hand the reaction a zero texture. */
    active: boolean;
  };
  flow: {
    curlStrength: number; curlScale: number; driftX: number;
    /** Already negated for the Y-up canvas. */
    driftY: number;
    advectAmount: number;
    /** False: advection would be an identity copy — skip both passes. */
    advecting: boolean;
  };
  palette: {
    a: number[]; b: number[]; c: number[]; d: number[];
    bands: number; relief: number; gloss: number; lightDir: number[];
  };
  display: { exposure: number; flash: number; tint: number[] };
}

export interface SeedSpots { xy: number[]; count: number; radius: number }
export interface Rung { index: number; maxSide: number; res: number }
export interface Size { width: number; height: number }

// The core writes these; its JSON is taken at its word at the boundary.
export function parseFrame(json: string): PictureFrame {
  const f: PictureFrame = JSON.parse(json);
  return f;
}

export function parseSeed(json: string): SeedSpots {
  const s: SeedSpots = JSON.parse(json);
  return s;
}

export function rungOf(picture: WebPicture): Rung {
  const r: Rung = JSON.parse(picture.rung());
  return r;
}

let ladder: Rung[] | null = null;
export function ladderRungs(): Rung[] {
  ladder ??= JSON.parse(qualityLadder());
  return ladder ?? [];
}

const pair = (v: Uint32Array): Size => ({ width: v[0], height: v[1] });

/** The canvas for a view at a rung's cap, from the core's ladder. */
export function canvasSize(maxSide: number, cssWidth: number, cssHeight: number, dpr: number): Size {
  return pair(backingStore(maxSide, Math.round(cssWidth * dpr), Math.round(cssHeight * dpr)));
}

/** The simulation grid for a canvas. */
export function gridFor(res: number, width: number, height: number): Size {
  return pair(simGrid(res, width, height));
}

/** `uRipples`: MAX_RIPPLES × [x, y, age, amp], zero-padded. */
export function packRipples(
  f: Pick<PictureFrame, 'ripples'>, out: Float32Array<ArrayBuffer> = new Float32Array(maxRipples() * 4),
): Float32Array<ArrayBuffer> {
  out.fill(0);
  f.ripples.slice(0, maxRipples()).forEach((r, i) => out.set(r, i * 4));
  return out;
}
