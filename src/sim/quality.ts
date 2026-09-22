// How big to render (pure). Two independent costs decide the frame time:
// the simulation grid (`res`, paid once per reaction substep) and the canvas
// backing store (`display.frag`, which does NOT shrink when `res` does).
// Measured on a software rasterizer at 1920x1080, preset 0 (16 substeps a
// frame), ms per pass — `analyze.mjs --render --passes`:
//
//   res 1024 / grid 1024x576   fields 120   react x16 1406   display 238
//   res  512 / grid  512x288   fields  38   react x16  373   display 248
//   res  256 / grid  256x144   fields  13   react x16  101   display 248
//
// The reaction is 80% of that first row — the noise fields are 7%. And with
// the grid made negligible (res 64), the canvas alone costs 262 ms at
// 1920x1031, 128 ms at 1280x671, 79 ms at 960x453, 46 ms at 640x271. Both
// axes have to come down together, which is what the ladder below does.
//
// Which rung a machine gets is measured, not guessed: the old test was
// `min(innerWidth, innerHeight) < 700`, which a 1080p single-board computer
// with no GPU passes with flying colours and then renders at 0.57 fps.

export interface QualityRung {
  /** Cap on the LONGEST side of the canvas backing store, device px. 0 = uncapped. */
  maxSide: number;
  /** Simulation grid long side (src/sim/grid.ts fits the short side to the aspect). */
  res: number;
}

// ~2x of total work per step (canvas area ~1.5x, grid area ~1.8-2.2x), so a
// rung that misses the budget misses it by about a factor of two — never by
// the 28x that separates the ends of the ladder.
export const QUALITY_LADDER: readonly QualityRung[] = [
  { maxSide: 640, res: 192 },
  { maxSide: 840, res: 256 },
  { maxSide: 1080, res: 384 },
  { maxSide: 1280, res: 512 },
  { maxSide: 1600, res: 768 },
  { maxSide: 0, res: 1024 }, // what every device got before auto-tuning
];

export const TOP_RUNG = QUALITY_LADDER.length - 1;

/**
 * A rung is accepted at 20 fps, not at the 15 fps floor we actually want:
 * the probe runs before any sound does, and the audio thread, the feature
 * extraction and the scout all take their cut afterwards.
 */
export const PROBE_BUDGET_MS = 50;

export interface CanvasSize {
  width: number;
  height: number;
}

/**
 * Backing store for a CSS box: device pixels, with the long side capped by
 * the rung. The CSS size stays 100% either way — the upscale is a blit, and
 * a blit is the one thing a software rasterizer is good at.
 */
export function backingStore(maxSide: number, cssWidth: number, cssHeight: number, dpr: number): CanvasSize {
  const w = Math.max(1, cssWidth * dpr);
  const h = Math.max(1, cssHeight * dpr);
  const long = Math.max(w, h);
  const k = maxSide > 0 && long > maxSide ? maxSide / long : 1;
  return {
    width: Math.max(1, Math.round(w * k)),
    height: Math.max(1, Math.round(h * k)),
  };
}

export interface ProbeOptions {
  /** A rung is kept if its median frame is no slower than this. */
  budgetMs: number;
  /** Frames to drop after a rung is applied (the first one reallocates textures). */
  warmup: number;
  /** Frames the median is taken over. */
  samples: number;
  /**
   * One frame this many times over budget fails the rung without waiting for
   * a full sample — but never the first frame measured at a rung, so a boot
   * hiccup cannot pin a fast machine at the bottom of the ladder.
   */
  abortFactor: number;
}

const DEFAULT_PROBE: ProbeOptions = { budgetMs: PROBE_BUDGET_MS, warmup: 2, samples: 5, abortFactor: 3 };

/**
 * Picks a rung by rendering at it. Walks UP from the cheapest one: the cost
 * of guessing wrong is then one frame of the rung above the machine's
 * ceiling (~2x the budget), where walking down from the top would cost one
 * frame at full quality — 2.6 s on the machine this was written for. The
 * picture is visibly coarse for the first few hundred milliseconds and then
 * sharpens, which beats a blank screen.
 *
 * Boot-time only (agreed with the user): once `done`, the rung never moves
 * again, so the picture cannot degrade under the viewer mid-listen.
 */
export class QualityProbe {
  /** The rung being measured, and — once `done` — the one to keep. */
  rung = 0;
  done = false;

  private readonly opts: ProbeOptions;
  private best = -1;
  private seen = 0;
  private times: number[] = [];

  constructor(opts: Partial<ProbeOptions> = {}) {
    this.opts = { ...DEFAULT_PROBE, ...opts };
  }

  /**
   * Feeds one frame's duration. Returns true when `rung` changed and the
   * caller must re-apply it (resize the canvas and the grid).
   */
  frame(ms: number): boolean {
    if (this.done) return false;
    if (this.seen++ < this.opts.warmup) return false;
    this.times.push(ms);
    if (this.times.length > 1 && ms > this.opts.budgetMs * this.opts.abortFactor) return this.settle();
    if (this.times.length < this.opts.samples) return false;

    const sorted = this.times.slice().sort((a, b) => a - b);
    if (sorted[Math.floor(sorted.length / 2)] > this.opts.budgetMs) return this.settle();
    this.best = this.rung;
    if (this.rung === TOP_RUNG) return this.settle();
    this.rung++;
    this.seen = 0;
    this.times = [];
    return true;
  }

  /** Stops at the best rung that fit — or the cheapest one, if none did. */
  private settle(): boolean {
    this.done = true;
    const keep = Math.max(0, this.best);
    if (keep === this.rung) return false;
    this.rung = keep;
    return true;
  }
}
