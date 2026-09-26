// Tanpura (PLAN.md #20): a drone that breathes in plucks. Four
// Karplus–Strong strings tuned Pa–Sa–Sa–Sa (3/2, 2, 2, 1 × the low Sa),
// plucked one after another in a slow cycle, so the band never breaks but
// the picture gets a gentle, regular attack to seed on (drones fire 1–2
// onset hits per 30 s otherwise). Pure — FormulaGenerator runs it per
// sample, tests/tanpura.test.ts checks tuning, plucks, dropout and bounds.
//
// Jawari, the curved bridge's buzz: a real string slaps onto the bridge
// at the top of each swing. Here each string adds a contact pulse while it
// is past 60% of its own swing: a smoothed step, env·σ(8·(y/env − 0.6)),
// with ~0.2 ms edges at 110 Hz, so a 1/f spectrum up to ~5 kHz (a hard
// step would alias). The pulse's height follows the string's swing ~120 ms
// behind, so the buzz blooms after each pluck and fades with the string;
// it is high-passed (two poles), so it adds "zz", not a second bass.
//
// The pluck is a finger, not a pick: a burst of two-pole low-passed noise
// three periods long. The first draft's one-period burst through one pole
// was a short broadband hit — a full-band line on the --png waterfall and
// ~65 "clicks" in 29 s (analysis/clicks.ts) at the default jawari; now 0.
// Measured dead ends: shortening the loop with the displacement (the
// textbook model) and adding the smooth wave tips past a threshold both
// made the tone DARKER — the first smears the upper partials' phase, the
// second is mostly fundamental.
// (Shortening the loop with the displacement, the other textbook model,
// was tried first and measured the wrong way: it DARKENED the tone, the
// modulation smearing the upper partials' phase until they died faster.)
import type { Rng } from './rng';

const RATIOS: readonly number[] = [1.5, 2, 2, 1];              // Pa, Sa, Sa, low Sa
const CENTS: readonly number[] = [0, -1.5, 1.5, 0];             // the two Sa beat slowly
const PLUCK_AT: readonly number[] = [0, 0.22, 0.44, 0.66];      // of the cycle; a rest after the low Sa
const LEVEL: readonly number[] = [0.85, 0.9, 0.9, 1];
const OUT = 0.5;
const PLUCK_PERIODS = 3; // how long the finger stays on the string
const BRIDGE = 0.6;       // the part of its swing past which a string touches the bridge
const EDGE = 8;           // contact edge steepness (σ gain)
// Measured (share of energy above 1.5 kHz, defaults otherwise): dry 0.033,
// jawari 0.5 → 0.087, jawari 1 → 0.18; the loudest settings peak at 0.77.
const JAWARI_GAIN = 4;
const BLOOM_SECONDS = 0.12;
const ENV_SECONDS = 0.05; // the swing follower's release
const BUZZ_HP_HZ = 1000;
const MIN_HZ = 25;

class KsString {
  readonly buf: Float32Array;
  readonly mask: number;
  write = 0;
  prev = 0;     // last read, for the KS two-point average
  y = 0;        // last output: the displacement the bridge sees
  env = 0;      // the swing: a peak follower of |y|
  swell = 0;    // the buzz level: the swing, ~120 ms behind
  excite = 0;   // samples of pluck left
  exciteLen = 1;
  exciteAmp = 0;
  noiseLp = 0;
  noiseLp2 = 0;

  constructor(sr: number) {
    let size = 1;
    while (size < sr / MIN_HZ + 8) size <<= 1;
    this.buf = new Float32Array(size);
    this.mask = size - 1;
  }

  reset(): void {
    this.buf.fill(0);
    this.write = 0;
    this.prev = 0;
    this.y = 0;
    this.excite = 0;
    this.noiseLp = 0;
    this.noiseLp2 = 0;
    this.env = 0;
    this.swell = 0;
  }
}

export class Tanpura {
  private readonly sr: number;
  private readonly rng: Rng;
  private readonly strings: KsString[];
  private cyc = -1e-12; // cycle phase 0..1; just below 0 so the first sample plucks Pa
  private dcX = 0;
  private dcY = 0;
  private buzzX = 0;
  private buzzY = 0;
  private buzzX2 = 0;
  private buzzY2 = 0;

  constructor(sr: number, rng: Rng) {
    this.sr = sr;
    this.rng = rng;
    this.strings = RATIOS.map(() => new KsString(sr));
  }

  reset(): void {
    for (const s of this.strings) s.reset();
    this.cyc = -1e-12;
    this.dcX = 0;
    this.dcY = 0;
    this.buzzX = 0;
    this.buzzY = 0;
    this.buzzX2 = 0;
    this.buzzY2 = 0;
  }

  private pluck(i: number, sa: number): void {
    const s = this.strings[i];
    s.exciteLen = Math.max(2, Math.round((PLUCK_PERIODS * this.sr) / (sa * RATIOS[i])));
    s.excite = s.exciteLen;
    s.exciteAmp = 0.8 + 0.2 * this.rng();
  }

  /**
   * One sample. sa: the low Sa (Hz); cycle: seconds for the four plucks;
   * jawari 0..1; sustain: seconds to fade 60 dB; bright 0..1: the pluck's tone.
   */
  next(sa: number, cycle: number, jawari: number, sustain: number, bright: number): number {
    const sr = this.sr;
    const saHz = Math.max(MIN_HZ, sa);
    let next = this.cyc + 1 / (Math.max(0.5, cycle) * sr);
    if (next >= 1) {
      next -= 1;
      this.pluck(0, saHz);
    }
    for (let i = 0; i < PLUCK_AT.length; i++) {
      if (this.cyc < PLUCK_AT[i] && next >= PLUCK_AT[i]) this.pluck(i, saHz);
    }
    this.cyc = next;

    const jaw = Math.max(0, Math.min(1, jawari)) * JAWARI_GAIN;
    const bloomA = 1 / (BLOOM_SECONDS * sr);
    const envDecay = Math.exp(-1 / (ENV_SECONDS * sr));
    const t60 = Math.max(0.2, sustain);
    const b = Math.max(0, Math.min(1, bright));
    const exciteA = 1 - Math.exp((-2 * Math.PI * (500 + 5500 * b * b)) / sr);
    const exciteNorm = (0.5 * Math.sqrt((2 - exciteA) / exciteA) * Math.sqrt(3)) / Math.sqrt(PLUCK_PERIODS);
    let sum = 0;
    let contact = 0;
    for (let i = 0; i < this.strings.length; i++) {
      const s = this.strings[i];
      const f = saHz * RATIOS[i] * Math.pow(2, CENTS[i] / 1200);
      const period = sr / f;
      // the two-point average below adds half a sample to the loop
      const delay = Math.max(2, period - 0.5);
      const pos = s.write - delay;
      const k = Math.floor(pos);
      const frac = pos - k;
      const a0 = s.buf[k & s.mask];
      const a1 = s.buf[(k + 1) & s.mask];
      const read = a0 + (a1 - a0) * frac;
      const g = Math.pow(10, -3 / (t60 * f));
      let v = g * 0.5 * (read + s.prev);
      s.prev = read;
      if (s.excite > 0) {
        // a raised-cosine burst of low-passed noise, one period long
        s.noiseLp += exciteA * (this.rng() * 2 - 1 - s.noiseLp);
        s.noiseLp2 += exciteA * (s.noiseLp - s.noiseLp2);
        const w = Math.sin((Math.PI * (s.exciteLen - s.excite)) / s.exciteLen);
        v += s.exciteAmp * w * w * s.noiseLp2 * exciteNorm;
        s.excite--;
      }
      s.buf[s.write] = v;
      s.write = (s.write + 1) & s.mask;
      s.y = read;
      sum += LEVEL[i] * read;
      s.env = Math.max(Math.abs(read), s.env * envDecay);
      s.swell += (s.env - s.swell) * bloomA;
      const touch = 0.5 + 0.5 * Math.tanh(EDGE * (read / Math.max(1e-9, s.env) - BRIDGE));
      contact += s.swell * touch;
    }
    // the buzz, high-passed (two poles): its rectified low end would muddy the bass
    const hpA = Math.exp((-2 * Math.PI * BUZZ_HP_HZ) / sr);
    this.buzzY = hpA * (this.buzzY + contact - this.buzzX);
    this.buzzX = contact;
    this.buzzY2 = hpA * (this.buzzY2 + this.buzzY - this.buzzX2);
    this.buzzX2 = this.buzzY;
    sum += jaw * this.buzzY2;
    // DC blocker: a noise burst is not zero-mean, and the KS loop keeps DC
    const x = sum * OUT;
    const y = x - this.dcX + 0.995 * this.dcY;
    this.dcX = x;
    this.dcY = y;
    return y;
  }
}
