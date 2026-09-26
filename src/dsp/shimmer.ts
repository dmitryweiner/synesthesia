// Shimmer (PLAN.md #20): an octave-up pitch shifter for the delay's feedback
// loop, so every echo comes back an octave higher and blooms into a halo
// above the drone (the Eno/Lanois sound). Pure — the worklet wraps it and
// tests/shimmer.test.ts runs the whole loop for 5 minutes.
//
// Two taps read a delay line at twice the write speed, half a grain apart,
// each under a sin² window. sin² + cos² = 1, so the shifted signal is a
// convex mix of past input and never exceeds the input's peak: the loop is
// bounded by its feedback gain alone, as the plain echo is. On top of that
// the shifted part is low-passed before it is read (reading at double speed
// folds whatever sits above sr/4, and each pass climbs an octave further
// into the low-pass, so the tail dies out) and soft-limited to ±1.
// Amount 0 passes the input through bit for bit: points without shimmer
// sound exactly as before.

const GRAIN_SECONDS = 0.08;
const LP_HZ = 4500;
const LIMIT_KNEE = 0.5;

function softLimit(v: number): number {
  const a = Math.abs(v);
  if (a <= LIMIT_KNEE) return v;
  const over = LIMIT_KNEE + (1 - LIMIT_KNEE) * Math.tanh((a - LIMIT_KNEE) / (1 - LIMIT_KNEE));
  return v < 0 ? -over : over;
}

export class OctaveShimmer {
  private readonly grain: number;
  private readonly window: Float32Array;
  private readonly buf: Float32Array;
  private readonly mask: number;
  private readonly lpA: number;
  private write = 0;
  private count = 0; // position within the grain, 0..grain-1
  private lp1 = 0;
  private lp2 = 0;

  constructor(sr: number) {
    this.grain = Math.max(64, Math.round(GRAIN_SECONDS * sr));
    this.window = Float32Array.from({ length: this.grain }, (_, c) => Math.sin((Math.PI * c) / this.grain) ** 2);
    let size = 1;
    while (size < 2 * this.grain + 2) size <<= 1;
    this.buf = new Float32Array(size);
    this.mask = size - 1;
    this.lpA = 1 - Math.exp((-2 * Math.PI * Math.min(LP_HZ, 0.2 * sr)) / sr);
  }

  /** input → output (same length); amount 0..1 = how much of the loop is shifted. */
  process(input: Float32Array, output: Float32Array, amount: number): void {
    const { buf, mask, grain, window, lpA } = this;
    const half = grain >> 1;
    const shifting = amount > 1e-6;
    let { write, count, lp1, lp2 } = this;
    for (let i = 0; i < input.length; i++) {
      const x = input[i];
      // two one-pole low-passes: the shifter's own input, always recorded
      // so that turning shimmer up finds a full delay line
      lp1 += lpA * (x - lp1);
      lp2 += lpA * (lp1 - lp2);
      buf[write] = lp2;
      if (shifting) {
        // the read delay falls by one sample per sample → reads at 2× speed
        const c2 = count + half < grain ? count + half : count + half - grain;
        const p = window[count] * buf[(write - (grain - count)) & mask]
          + window[c2] * buf[(write - (grain - c2)) & mask];
        output[i] = x + amount * (softLimit(p) - x);
      } else {
        output[i] = x;
      }
      write = (write + 1) & mask;
      count = count + 1 < grain ? count + 1 : 0;
    }
    this.write = write;
    this.count = count;
    this.lp1 = lp1;
    this.lp2 = lp2;
  }
}
