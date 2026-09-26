// Numbers for the picture (PLAN.md #22, B8): read from the simulation's V
// channel (the "ink"), not from pixels, so palette and light don't enter.
// coverage — share of cells holding pattern (the canvas filling, or dying);
// edges — share of cells on a steep boundary (how intricate it is);
// change — mean |ΔV| since the previous sample (still moving, or frozen).
// A tool that prints numbers (analyze.mjs --picture); whether any of them
// becomes a guard is decided later, from real numbers. Pure.

export interface PictureMetrics {
  coverage: number;
  edges: number;
  /** NaN without a previous sample. */
  change: number;
  alive: boolean;
}

const INK = 0.1;        // V above this is pattern (background V ≈ 0, pattern 0.2–0.4)
const EDGE = 0.04;      // |∇V| per cell above this is a boundary
const ALIVE = 0.01;     // less than 1% of the canvas is not a picture

export function pictureMetrics(v: Float32Array, width: number, height: number, prev?: Float32Array): PictureMetrics {
  let ink = 0;
  let edges = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      if (v[i] > INK) ink++;
      const gx = x + 1 < width ? v[i + 1] - v[i] : 0;
      const gy = y + 1 < height ? v[i + width] - v[i] : 0;
      if (Math.hypot(gx, gy) > EDGE) edges++;
    }
  }
  let change = NaN;
  if (prev && prev.length === v.length) {
    let s = 0;
    for (let i = 0; i < v.length; i++) s += Math.abs(v[i] - prev[i]);
    change = s / v.length;
  }
  const n = width * height;
  return { coverage: ink / n, edges: edges / n, change, alive: ink / n >= ALIVE };
}
