// DSP core: per-sample generation of every formula. Pure module without Web
// Audio — imported by the AudioWorklet processor (src/worklet) and by unit
// tests. Ported from formula-synth (math, normalizations and clamps
// unchanged) with one deliberate fix: every oscillator ACCUMULATES its phase
// (φ += 2π·f/sr) instead of computing sin(2π·f·t) from absolute time. With
// absolute time, any frequency change — an LFO route (every audio block), a
// morph step, a preset switch — jumps the phase by 2π·Δf·t, which grows with
// how long the sound has been playing: after a minute it's an arbitrary
// phase step on every block, heard as harsh beating (tests/continuity).
// For constant parameters the waveforms are unchanged.
import type { Rng } from './rng';
import type { LfoDef, ModRoute, ParamRanges } from './mod';
import { lfoValue, effectiveParam } from './mod';

export type FormulaId =
  | 'fm' | 'logistic' | 'gliss' | 'additive' | 'pm' | 'beats' | 'dist' | 'quasi'
  | 'lorenz' | 'karplus' | 'noiselp' | 'pinknoise' | 'brownnoise' | 'velvetnoise'
  | 'rossler' | 'shepard' | 'bytebeat' | 'bell' | 'ocean' | 'risset' | 'rain';

export const FORMULA_IDS: readonly FormulaId[] = [
  'fm', 'logistic', 'gliss', 'additive', 'pm', 'beats', 'dist', 'quasi',
  'lorenz', 'karplus', 'noiselp', 'pinknoise', 'brownnoise', 'velvetnoise',
  'rossler', 'shepard', 'bytebeat', 'bell', 'ocean', 'risset', 'rain',
];

const FORMULA_ID_SET: ReadonlySet<string> = new Set(FORMULA_IDS);

export function isFormulaId(id: string): id is FormulaId {
  return FORMULA_ID_SET.has(id);
}

export type Params = Record<string, number>;

// Shared default pool for all formulas.
export const DEFAULT_PARAMS: Readonly<Params> = {
  gain: 0.2,
  fc: 220, fm: 2, I: 2,
  base: 110, depth: 330, r: 3.86, lfoHz: 40,
  f0: 55, k: 0.15,
  fund: 110, N: 12, move: 0.35,
  f: 220, f2pm: 3,
  fbeat: 220, df: 0.8,
  fd: 110, alpha: 3.0,
  fq: 120, Aq: 220, wq: 0.8,
  sigma: 10, rho: 28, beta: 2.6667,
  lBase: 120, lFreqScale: 40, lAmp: 0.25,
  ksFreq: 110, ksDamp: 0.985, ksBright: 0.5,
  nCut: 800,
  pinkBright: 0.5,
  brownStep: 0.02,
  velvetDensity: 2000,
  rossA: 0.2, rossB: 0.2, rossC: 5.7,
  rossBase: 120, rossFreqScale: 30, rossAmp: 0.25,
  shepBase: 55, shepSpeed: 0.1, shepOctaves: 6,
  bbRecipe: 1, bbRate: 8000,
  bellF0: 320, bellRatio: 1.4, bellIndex: 4, bellDecay: 3, bellPeriod: 6,
  oceanRate: 0.12, oceanCut: 600, oceanDepth: 0.7,
  rissF0: 480, rissDecay: 5, rissPeriod: 6,
  rainDensity: 4, rainPitch: 900, rainBed: 0.15,
};

// Classic bytebeat recipes: integer t, result taken mod 256.
const BYTEBEAT_RECIPES: readonly ((t: number) => number)[] = [
  (t) => ((t >> 10) & 42) * t,
  (t) => t * ((t >> 12 | t >> 8) & 63 & (t >> 4)),
  (t) => (t * (t >> 5 | t >> 8)) >> (t >> 16),
  (t) => t * 5 & (t >> 7) | t * 3 & (t * 4 >> 10),
  (t) => (t >> 7 | t | t >> 6) * 10 + 4 * (t & t >> 13 | t >> 6),
];

// Jean-Claude Risset's bell (1969): 11 inharmonic components with individual
// amplitudes and decay times; two detuned pairs give the characteristic beats.
const RISSET_RATIO: readonly number[] = [0.56, 0.56, 0.92, 0.92, 1.19, 1.70, 2.00, 2.74, 3.00, 3.76, 4.07];
const RISSET_AMP: readonly number[] = [1, 0.67, 1, 1.8, 2.67, 1.67, 1.46, 1.33, 1.33, 1, 1.33];
const RISSET_DET: readonly number[] = [0, 1, 0, 1.7, 0, 0, 0, 0, 0, 0, 0]; // Hz offset
const RISSET_DUR: readonly number[] = [1, 0.9, 0.65, 0.55, 0.325, 0.35, 0.25, 0.2, 0.15, 0.1, 0.075];
const RISSET_AMP_SUM = RISSET_AMP.reduce((s, a) => s + a, 0);

const TWO_PI = 2 * Math.PI;
const GLISS_SPAN = Math.log(16); // restart a glissando after 4 octaves

function clamp(x: number, a: number, b: number): number {
  return Math.max(a, Math.min(b, x));
}

export class FormulaGenerator {
  readonly formula: FormulaId;
  readonly sr: number;
  readonly p: Params;
  private rng: Rng;

  private t = 0;
  private phase = 0;

  private logi = 0.33;
  private lx = 0.1; private ly = 0; private lz = 0;

  private ksBuf: Float32Array | null = null;
  private ksIdx = 0;
  private ksN = 0;
  private nlp = 0;

  // Pink noise (Paul Kellet's approximation)
  private pinkB0 = 0; private pinkB1 = 0; private pinkB2 = 0;
  private pinkB3 = 0; private pinkB4 = 0; private pinkB5 = 0; private pinkB6 = 0;

  private brownVal = 0;

  private velvetCounter = 0;
  private velvetNext = 0;

  private rx = 0.1; private ry = 0; private rz = 0;

  // Accumulated oscillator phases (radians, wrapped): carrier/fundamental,
  // modulator/second oscillator, and the slow LFO-like terms (additive's
  // move, quasi's w·t, ocean's swells).
  private ph1 = 0;
  private ph2 = 0;
  private ph3 = 0;
  private ph4 = 0;
  private glissLog = 0; // ln(f/f0) of the glissando
  private rissPhases = new Float64Array(11);

  private shepardPhases = new Float32Array(10);
  private shepardT = 0;

  private bbT = 0;
  private bellT = 0;
  private oceanLp = 0;

  private rissT = 0;
  private rainLp = 0;
  private dropT = 1e9; // time since the current drop started (huge = no drop)
  private dropPhase = 0;
  private dropFreq = 0;
  private dropAmp = 0;
  private rainCounter = 0;
  private rainNext = 0;

  // Block-rate modulation. modT is absolute LFO time; NOT reset by reset()
  // (reset restarts the sound, not the modulation).
  private modT = 0;
  private modLfos: readonly LfoDef[] = [];
  private modRoutes: readonly ModRoute[] = [];
  private modRanges: ParamRanges = {};
  private modSaved: number[] = [];

  constructor(formula: FormulaId, sampleRate: number, params?: Params, rng: Rng = Math.random) {
    this.formula = formula;
    this.sr = sampleRate;
    this.rng = rng;
    this.p = { ...DEFAULT_PARAMS, ...(params ?? {}) };
    this.initKS(true);
  }

  set(params: Params): void {
    for (const [k, v] of Object.entries(params)) this.p[k] = v;
  }

  /** Modulation routes aimed at this generator, plus the LFO pool and ranges. */
  setMod(lfos: readonly LfoDef[], routes: readonly ModRoute[], ranges: ParamRanges): void {
    this.modLfos = lfos;
    this.modRoutes = routes;
    this.modRanges = ranges;
  }

  reset(): void {
    this.t = 0; this.phase = 0;
    this.ph1 = 0; this.ph2 = 0; this.ph3 = 0; this.ph4 = 0;
    this.glissLog = 0;
    this.rissPhases.fill(0);
    this.logi = 0.33;
    this.lx = 0.1; this.ly = 0; this.lz = 0;
    this.nlp = 0;
    this.initKS(true);
    this.pinkB0 = 0; this.pinkB1 = 0; this.pinkB2 = 0;
    this.pinkB3 = 0; this.pinkB4 = 0; this.pinkB5 = 0; this.pinkB6 = 0;
    this.brownVal = 0;
    this.velvetCounter = 0; this.velvetNext = 0;
    this.rx = 0.1; this.ry = 0; this.rz = 0;
    this.shepardPhases.fill(0);
    this.shepardT = 0;
    this.bbT = 0;
    this.bellT = 0;
    this.oceanLp = 0;
    this.rissT = 0;
    this.rainLp = 0;
    this.dropT = 1e9; this.dropPhase = 0; this.dropFreq = 0; this.dropAmp = 0;
    this.rainCounter = 0; this.rainNext = 0;
  }

  private initKS(force: boolean): void {
    const p = this.p;
    const freq = Math.max(20, p.ksFreq || 110);
    const N = Math.max(2, Math.floor(this.sr / freq));
    if (!force && this.ksBuf && this.ksN === N) return;
    this.ksN = N;
    this.ksBuf = new Float32Array(N);
    this.ksIdx = 0;
    for (let i = 0; i < N; i++) this.ksBuf[i] = this.rng() * 2 - 1;
  }

  fill(out: Float32Array): void {
    const n = out.length;
    const sr = this.sr;
    const rng = this.rng;
    const p = this.p;

    // Overwrite-then-restore: save base values of modulated params, write the
    // effective ones (constant across the block), run the block, restore.
    const routes = this.modRoutes;
    const modSaved = this.modSaved;
    modSaved.length = 0;
    for (let ri = 0; ri < routes.length; ri++) {
      const r = routes[ri];
      const base = p[r.param];
      modSaved.push(base);
      const lfo = this.modLfos[r.src];
      const range = this.modRanges[r.param];
      if (lfo === undefined || range === undefined || !Number.isFinite(base)) continue;
      p[r.param] = effectiveParam(base, lfoValue(lfo, this.modT), r.depth, range, r.exp ?? false);
    }

    let phase = this.phase;
    let t = this.t;
    let logi = this.logi;
    let lx = this.lx, ly = this.ly, lz = this.lz;
    let nlp = this.nlp;
    let ph1 = this.ph1, ph2 = this.ph2, ph3 = this.ph3, ph4 = this.ph4;
    const w = TWO_PI / sr; // radians per sample per Hz

    for (let i = 0; i < n; i++) {
      let x = 0;
      switch (this.formula) {
        case 'fm':
          x = Math.sin(ph1 + p.I * Math.sin(ph2));
          ph1 += w * p.fc;
          ph2 += w * p.fm;
          break;
        case 'logistic': {
          const step = Math.max(1, Math.floor(sr / Math.max(1e-3, p.lfoHz)));
          if (i % step === 0) { logi = p.r * logi * (1 - logi); logi = clamp(logi, 0, 1); }
          const f = p.base + p.depth * (logi - 0.5);
          phase += TWO_PI * (Math.max(0, f) / sr);
          x = Math.sin(phase);
          break;
        }
        case 'gliss': {
          // Log-frequency state instead of exp(k·t): f0/k changes bend the
          // sweep instead of jumping it. Restart at f0 once it has glided
          // GLISS_SPAN away (4 octaves) — with absolute t it would climb
          // into ultrasound and stay there forever.
          this.glissLog += p.k / sr;
          if (Math.abs(this.glissLog) > GLISS_SPAN) this.glissLog = 0;
          const f = p.f0 * Math.exp(this.glissLog);
          phase += w * f;
          x = Math.sin(phase);
          break;
        }
        case 'additive': {
          const fund = p.fund;
          const N = Math.max(1, Math.floor(p.N));
          const move = p.move;
          let s = 0;
          for (let k = 1; k <= N; k++) {
            const ak = (1 / k) * Math.sin(ph3 + k);
            s += ak * Math.sin(k * ph1); // harmonic k rides the fundamental's phase
          }
          x = s * (1.0 / Math.log2(N + 1));
          ph1 += w * fund;
          ph3 += w * move;
          break;
        }
        case 'pm': {
          const phi = Math.sin(Math.sin(ph2));
          x = Math.sin(ph1 + phi * 5.0);
          ph1 += w * p.f;
          ph2 += w * p.f2pm;
          break;
        }
        case 'beats':
          x = 0.5 * (Math.sin(ph1) + Math.sin(ph2));
          ph1 += w * p.fbeat;
          ph2 += w * (p.fbeat + p.df);
          break;
        case 'dist':
          x = Math.tanh(p.alpha * Math.sin(ph1));
          ph1 += w * p.fd;
          break;
        case 'quasi': {
          const mod = Math.sin(Math.sin(Math.sin(ph3))); // ph3 = ∫ w_q dt (w_q in rad/s)
          ph3 += p.wq / sr;
          const f = Math.max(0, p.fq + p.Aq * mod);
          phase += TWO_PI * (f / sr);
          x = Math.sin(phase);
          break;
        }
        case 'lorenz': {
          const dt = 1 / sr;
          const dx = p.sigma * (ly - lx);
          const dy = lx * (p.rho - lz) - ly;
          const dz = lx * ly - p.beta * lz;
          lx += dx * dt; ly += dy * dt; lz += dz * dt;

          const freq = Math.max(0, p.lBase + p.lFreqScale * Math.abs(lx));
          const amp = clamp(p.lAmp * (0.3 + 0.7 * (0.5 + 0.5 * Math.tanh(ly))), 0, 1);
          phase += TWO_PI * (freq / sr);
          x = amp * Math.sin(phase);
          break;
        }
        case 'karplus': {
          this.initKS(false);
          const buf = this.ksBuf;
          if (!buf) break;
          const N = this.ksN;
          const idx = this.ksIdx;
          const y0 = buf[idx];
          const y1 = buf[(idx + 1) % N];
          const damp = clamp(p.ksDamp, 0.8, 0.99999);
          const bright = clamp(p.ksBright, 0, 1);
          const avg = 0.5 * (y0 + y1);
          const next = damp * (bright * y0 + (1 - bright) * avg);
          buf[idx] = next;
          this.ksIdx = (idx + 1) % N;
          x = y0;
          break;
        }
        case 'noiselp': {
          const white = rng() * 2 - 1;
          const cut = clamp(p.nCut, 20, 18000);
          const a = 1 - Math.exp((-2 * Math.PI * cut) / sr);
          nlp = nlp + a * (white - nlp);
          x = nlp;
          break;
        }
        case 'pinknoise': {
          const white = rng() * 2 - 1;
          this.pinkB0 = 0.99886 * this.pinkB0 + white * 0.0555179;
          this.pinkB1 = 0.99332 * this.pinkB1 + white * 0.0750759;
          this.pinkB2 = 0.969 * this.pinkB2 + white * 0.153852;
          this.pinkB3 = 0.8665 * this.pinkB3 + white * 0.3104856;
          this.pinkB4 = 0.55 * this.pinkB4 + white * 0.5329522;
          this.pinkB5 = -0.7616 * this.pinkB5 - white * 0.016898;
          const pink = this.pinkB0 + this.pinkB1 + this.pinkB2 + this.pinkB3
            + this.pinkB4 + this.pinkB5 + this.pinkB6 + white * 0.5362;
          this.pinkB6 = white * 0.115926;
          const bright = clamp(p.pinkBright, 0, 1);
          x = pink * 0.11 * (1 - bright) + white * bright * 0.5;
          break;
        }
        case 'brownnoise': {
          const white = rng() * 2 - 1;
          const step = clamp(p.brownStep, 0.001, 0.1);
          this.brownVal = clamp(this.brownVal + white * step, -1, 1);
          x = this.brownVal;
          break;
        }
        case 'velvetnoise': {
          const density = Math.max(100, p.velvetDensity);
          const avgSamples = sr / density;
          if (this.velvetCounter >= this.velvetNext) {
            x = rng() > 0.5 ? 1 : -1;
            this.velvetNext = this.velvetCounter + avgSamples * (0.5 + rng());
          } else {
            x = 0;
          }
          this.velvetCounter++;
          break;
        }
        case 'rossler': {
          const dt = 1 / sr;
          const a = p.rossA, b = p.rossB, c = p.rossC;
          const dx = -this.ry - this.rz;
          const dy = this.rx + a * this.ry;
          const dz = b + this.rz * (this.rx - c);
          this.rx += dx * dt * 100;
          this.ry += dy * dt * 100;
          this.rz += dz * dt * 100;
          // Clamp against attractor blow-up
          this.rx = clamp(this.rx, -50, 50);
          this.ry = clamp(this.ry, -50, 50);
          this.rz = clamp(this.rz, -50, 50);

          const freq = Math.max(0, p.rossBase + p.rossFreqScale * this.rx);
          const amp = clamp(p.rossAmp * (0.3 + 0.7 * (0.5 + 0.02 * this.ry)), 0, 1);
          phase += TWO_PI * (freq / sr);
          x = amp * Math.sin(phase);
          break;
        }
        case 'shepard': {
          const baseF = Math.max(20, p.shepBase);
          const speed = p.shepSpeed;
          const octaves = Math.max(1, Math.min(10, Math.floor(p.shepOctaves)));
          const centerLog = Math.log2(440);
          const sigma = 1.5; // Gaussian envelope width in log-frequency

          this.shepardT += speed / sr;
          if (this.shepardT > 1) this.shepardT -= 1;
          if (this.shepardT < 0) this.shepardT += 1;

          let sum = 0;
          for (let k = 0; k < octaves; k++) {
            const freqMult = Math.pow(2, k + this.shepardT);
            const freq = baseF * freqMult;
            if (freq > 18000) continue;

            const logF = Math.log2(freq);
            const envelope = Math.exp(-0.5 * Math.pow((logF - centerLog) / sigma, 2));

            this.shepardPhases[k] += TWO_PI * (freq / sr);
            if (this.shepardPhases[k] > TWO_PI) this.shepardPhases[k] -= TWO_PI;
            sum += envelope * Math.sin(this.shepardPhases[k]);
          }
          x = sum / Math.sqrt(octaves);
          break;
        }
        case 'bytebeat': {
          // Integer bytebeat "time" runs at its own rate bbRate
          this.bbT += Math.max(500, p.bbRate) / sr;
          const bt = Math.floor(this.bbT);
          const idx = clamp(Math.floor(p.bbRecipe), 1, BYTEBEAT_RECIPES.length) - 1;
          const byte = BYTEBEAT_RECIPES[idx](bt) & 255;
          x = byte / 128 - 1;
          break;
        }
        case 'bell': {
          // FM bell: inharmonic modulator + exponential decay; strikes every bellPeriod s
          const decay = Math.max(0.1, p.bellDecay);
          const env = Math.exp((-3 * this.bellT) / decay);
          const f0 = p.bellF0;
          x = env * Math.sin(ph1 + p.bellIndex * env * Math.sin(ph2));
          ph1 += w * f0;
          ph2 += w * f0 * p.bellRatio;
          this.bellT += 1 / sr;
          if (this.bellT >= Math.max(0.5, p.bellPeriod)) { this.bellT = 0; ph1 = 0; ph2 = 0; } // new strike
          break;
        }
        case 'ocean': {
          // Noise through an LP whose brightness and level breathe with two
          // incommensurate LFOs — wave swells / wind gusts
          const white = rng() * 2 - 1;
          const swell1 = 0.5 + 0.5 * Math.sin(ph3 - Math.PI / 2);
          const swell2 = 0.5 + 0.5 * Math.sin(ph4 + 1.7);
          ph3 += w * p.oceanRate;
          ph4 += w * p.oceanRate * 0.37;
          const mix = Math.pow(0.6 * swell1 + 0.4 * swell2, 2);
          const depth = clamp(p.oceanDepth, 0, 1);
          const cut = clamp(p.oceanCut * (1 - depth + depth * 2 * mix), 40, 8000);
          const a = 1 - Math.exp((-2 * Math.PI * cut) / sr);
          this.oceanLp = this.oceanLp + a * (white - this.oceanLp);
          x = this.oceanLp * (1 - depth + depth * mix) * 1.8;
          break;
        }
        case 'risset': {
          // Additive Risset bell: sum of decaying inharmonic partials; strikes every rissPeriod s
          const decay = Math.max(0.2, p.rissDecay);
          const f0 = Math.max(20, p.rissF0);
          let s = 0;
          const rp = this.rissPhases;
          for (let c = 0; c < RISSET_RATIO.length; c++) {
            const env = Math.exp(-this.rissT / (RISSET_DUR[c] * decay));
            s += RISSET_AMP[c] * env * Math.sin(rp[c]);
            rp[c] += w * (f0 * RISSET_RATIO[c] + RISSET_DET[c]);
            if (rp[c] > TWO_PI) rp[c] -= TWO_PI;
          }
          x = s / RISSET_AMP_SUM;
          this.rissT += 1 / sr;
          if (this.rissT >= Math.max(0.5, p.rissPeriod)) { this.rissT = 0; rp.fill(0); } // new strike
          break;
        }
        case 'rain': {
          // Drops: soft noise bed + sparse resonant "plinks" with a rising glide
          const density = Math.max(0.2, p.rainDensity);
          const avgSamples = sr / density;
          if (this.rainCounter >= this.rainNext) {
            this.dropT = 0;
            this.dropPhase = 0;
            this.dropAmp = 0.5 + 0.5 * rng();
            this.dropFreq = clamp(p.rainPitch * (0.6 + 0.9 * rng()), 100, 6000);
            this.rainNext = this.rainCounter + avgSamples * (0.5 + rng());
          }
          this.rainCounter++;

          const dropDecay = 0.12;
          const env = Math.exp(-this.dropT / dropDecay);
          const glide = 1 + 0.5 * (1 - Math.exp(-this.dropT * 60));
          this.dropPhase += (TWO_PI * this.dropFreq * glide) / sr;
          const drop = this.dropAmp * env * Math.sin(this.dropPhase);
          this.dropT += 1 / sr;

          const white = rng() * 2 - 1;
          const bedA = 1 - Math.exp((-2 * Math.PI * 2000) / sr);
          this.rainLp = this.rainLp + bedA * (white - this.rainLp);
          const bed = clamp(p.rainBed, 0, 1);

          x = drop * 0.9 + this.rainLp * bed * 0.6;
          break;
        }
      }

      out[i] = x * (p.gain ?? 0.2);
      t += 1 / sr;
      if (phase > 1e9) phase %= TWO_PI;
    }
    // wrap once per block: keeps precision, and k·ph1 (additive) stays exact mod 2π
    ph1 %= TWO_PI; ph2 %= TWO_PI; ph3 %= TWO_PI; ph4 %= TWO_PI;
    this.ph1 = ph1; this.ph2 = ph2; this.ph3 = ph3; this.ph4 = ph4;

    this.phase = phase; this.t = t; this.logi = logi;
    this.lx = lx; this.ly = ly; this.lz = lz;
    this.nlp = nlp;

    // Restore base values of modulated params and advance LFO time.
    for (let ri = 0; ri < routes.length; ri++) p[routes[ri].param] = modSaved[ri];
    this.modT += n / sr;
  }
}
