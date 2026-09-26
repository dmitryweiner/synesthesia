// "Hearing" without ears: render every formula in the pure core and check
// the sound exists, is finite and bounded. Catches dead formulas and
// NaN/Inf from parameter combos that range tests can't see.
import { FormulaGenerator, FORMULA_IDS, DEFAULT_PARAMS, isFormulaId } from '../src/dsp/generator';
import type { FormulaId, Params } from '../src/dsp/generator';
import { FORMULAS, formulaDefaults } from '../src/schema/audio';
import { mulberry32 } from '../src/dsp/rng';

const SR = 48000;
const BLOCK = 128;

function renderInto(gen: FormulaGenerator, mix: Float32Array): void {
  const buf = new Float32Array(BLOCK);
  for (let i = 0; i < mix.length; i += BLOCK) {
    gen.fill(buf);
    for (let j = 0; j < BLOCK && i + j < mix.length; j++) mix[i + j] += buf[j];
  }
}

export function stats(buf: Float32Array): { peak: number; rms: number; finite: boolean; span: number } {
  let peak = 0, sumSq = 0, min = Infinity, max = -Infinity, finite = true;
  for (const v of buf) {
    if (!Number.isFinite(v)) finite = false;
    const a = Math.abs(v);
    if (a > peak) peak = a;
    sumSq += v * v;
    if (v < min) min = v;
    if (v > max) max = v;
  }
  return { peak, rms: Math.sqrt(sumSq / buf.length), finite, span: max - min };
}

describe('schema/audio', () => {
  it('every formula id has a UI definition and vice versa', () => {
    expect(FORMULAS.map((f) => f.id).sort()).toEqual([...FORMULA_IDS].sort());
  });

  it('every slider key has a DEFAULT_PARAMS entry', () => {
    for (const f of FORMULAS) {
      for (const s of f.sliders) expect(DEFAULT_PARAMS[s.k], `${f.id}.${s.k}`).toBeDefined();
    }
  });

  it('slider defaults lie within their ranges', () => {
    for (const f of FORMULAS) {
      for (const s of f.sliders) {
        expect(s.value).toBeGreaterThanOrEqual(s.min);
        expect(s.value).toBeLessThanOrEqual(s.max);
      }
    }
  });

  it('isFormulaId', () => {
    expect(isFormulaId('fm')).toBe(true);
    expect(isFormulaId('nope')).toBe(false);
  });
});

describe('generator: each formula at UI defaults', () => {
  it.each([...FORMULA_IDS])('%s: audible, finite, bounded', (id) => {
    const gen = new FormulaGenerator(id, SR, formulaDefaults(id), mulberry32(42));
    const buf = new Float32Array(SR);
    renderInto(gen, buf);
    const s = stats(buf);
    expect(s.finite, `${id}: NaN/Inf`).toBe(true);
    expect(s.rms, `${id}: silent (rms=${s.rms})`).toBeGreaterThan(1e-4);
    expect(s.span, `${id}: constant`).toBeGreaterThan(1e-4);
    expect(s.peak, `${id}: peak ${s.peak}`).toBeLessThanOrEqual(1.5);
  });
});

describe('generator: determinism and reset', () => {
  it('same seed → identical output', () => {
    const a = new FormulaGenerator('rain', SR, {}, mulberry32(3));
    const b = new FormulaGenerator('rain', SR, {}, mulberry32(3));
    const x = new Float32Array(1024);
    const y = new Float32Array(1024);
    renderInto(a, x);
    renderInto(b, y);
    expect(Array.from(x)).toEqual(Array.from(y));
  });

  it('reset() restarts the sound (fm phase back to t=0)', () => {
    const gen = new FormulaGenerator('fm', SR, {}, mulberry32(1));
    const first = new Float32Array(256);
    renderInto(gen, first);
    const later = new Float32Array(256);
    renderInto(gen, later);
    expect(Array.from(later)).not.toEqual(Array.from(first));
    gen.reset();
    const again = new Float32Array(256);
    renderInto(gen, again);
    expect(Array.from(again)).toEqual(Array.from(first));
  });

  it('set() updates params live', () => {
    const gen = new FormulaGenerator('beats', SR, { gain: 0.5 }, mulberry32(1));
    expect(gen.p.gain).toBe(0.5);
    gen.set({ gain: 0.1 });
    expect(gen.p.gain).toBe(0.1);
  });

  it('extreme params never produce NaN (each formula, min and max of every slider)', () => {
    for (const f of FORMULAS) {
      for (const edge of ['min', 'max'] as const) {
        const params: Params = {};
        for (const s of f.sliders) params[s.k] = s[edge];
        const gen = new FormulaGenerator(f.id, SR, params, mulberry32(5));
        const buf = new Float32Array(4096);
        renderInto(gen, buf);
        expect(stats(buf).finite, `${f.id} @ ${edge}`).toBe(true);
      }
    }
  });
});

describe('generator: block-rate modulation', () => {
  it('LFO route changes the sound; base param restored after each block', () => {
    const fid: FormulaId = 'fm';
    const gen = new FormulaGenerator(fid, SR, { fc: 200, I: 2 }, mulberry32(1));
    gen.setMod([{ shape: 'square', rate: 100, phase: 0 }], [{ src: 0, target: fid, param: 'I', depth: 0.5 }], { I: [0, 20] });
    const buf = new Float32Array(BLOCK);
    gen.fill(buf);
    expect(gen.p.I).toBe(2);
    const plain = new FormulaGenerator(fid, SR, { fc: 200, I: 2 }, mulberry32(1));
    const ref = new Float32Array(BLOCK);
    plain.fill(ref);
    expect(Array.from(buf)).not.toEqual(Array.from(ref));
  });

  it('two routes on one param add up, and the base survives every block (PLAN.md #19)', () => {
    // Saving/restoring per route used to write the FIRST route's effective
    // value back as the base whenever a param had two routes: it drifted.
    const lfos = [{ shape: 'sine' as const, rate: 3, phase: 0 }];
    const ranges = { I: [0, 20] as const };
    const two = new FormulaGenerator('fm', SR, { fc: 200, I: 2 }, mulberry32(1));
    two.setMod(lfos, [
      { src: 0, target: 'fm', param: 'I', depth: 0.02 },
      { src: 0, target: 'fm', param: 'I', depth: 0.03 },
    ], ranges);
    const one = new FormulaGenerator('fm', SR, { fc: 200, I: 2 }, mulberry32(1));
    one.setMod(lfos, [{ src: 0, target: 'fm', param: 'I', depth: 0.05 }], ranges);
    const a = new Float32Array(BLOCK);
    const b = new Float32Array(BLOCK);
    for (let blk = 0; blk < 400; blk++) {
      two.fill(a);
      one.fill(b);
      expect(two.p.I).toBe(2);
    }
    for (let i = 0; i < BLOCK; i++) expect(a[i]).toBeCloseTo(b[i], 6);
  });
});
