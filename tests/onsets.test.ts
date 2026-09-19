// Onset detection on the presets' real generator audio, through a pure
// emulation of the browser's AnalyserNode — so "does a bell strike make the
// picture react?" is a unit test, not a guess. FX (reverb, delay) are not
// included here; scripts/analyze.mjs --onsets checks the full graph.
import { simulateAnalyser } from '../src/audio/analyserSim';
import { FeatureTracker, OnsetDetector } from '../src/audio/features';
import { FormulaGenerator, FORMULA_IDS } from '../src/dsp/generator';
import { buildModPayload } from '../src/audio/modrouting';
import { FORMULAS } from '../src/schema/audio';
import { PRESETS } from '../src/presets';
import { mulberry32 } from '../src/dsp/rng';

const SR = 24000;

function renderPreset(name: string, seconds: number): Float32Array {
  const p = PRESETS.find((x) => x.name === name);
  if (!p) throw new Error(name);
  const mix = new Float32Array(Math.round(SR * seconds));
  let seed = 1;
  for (const [id, snap] of Object.entries(p.state.audio.formulas)) {
    if (!snap.enabled) continue;
    const fid = FORMULA_IDS.find((f) => f === id);
    if (!fid) continue;
    const gen = new FormulaGenerator(fid, SR, snap.params, mulberry32(seed++));
    const pay = buildModPayload(p.state.mod, fid, FORMULAS);
    gen.setMod(pay.lfos, pay.routes, pay.ranges);
    const buf = new Float32Array(128);
    for (let i = 0; i < mix.length; i += 128) {
      gen.fill(buf);
      for (let j = 0; j < 128 && i + j < mix.length; j++) mix[i + j] += buf[j] * p.state.audio.masterGain;
    }
  }
  return mix;
}

function countHits(samples: Float32Array, fps = 60): { hits: number; swellMax: number; swellMin: number } {
  const tr = new FeatureTracker(SR);
  const det = new OnsetDetector();
  let hits = 0;
  let swellMax = -1;
  let swellMin = 1;
  for (const f of simulateAnalyser(samples, SR, { fps })) {
    const feat = tr.update(f.timeDomain, f.bytes, 1 / fps);
    if (det.update(feat.onset, f.t)) hits++;
    if (f.t > 2) { swellMax = Math.max(swellMax, feat.swell); swellMin = Math.min(swellMin, feat.swell); }
  }
  return { hits, swellMax, swellMin };
}

describe('simulateAnalyser', () => {
  it('byte spectrum of a sine peaks at its bin; silence is all zeros', () => {
    const n = SR;
    const x = new Float32Array(n);
    for (let i = 0; i < n; i++) x[i] = 0.5 * Math.sin((2 * Math.PI * 1500 * i) / SR);
    const frames = [...simulateAnalyser(x, SR, { fps: 10 })];
    const last = frames[frames.length - 1].bytes;
    let peak = 0;
    for (let i = 1; i < last.length; i++) if (last[i] > last[peak]) peak = i;
    expect(peak * (SR / 2 / last.length)).toBeCloseTo(1500, -2);
    expect(last[peak]).toBeGreaterThan(200);
    const silent = [...simulateAnalyser(new Float32Array(n), SR, { fps: 10 })];
    expect(silent[silent.length - 1].bytes.every((b) => b === 0)).toBe(true);
  });
});

describe('onset hits on real preset audio', () => {
  it('Bell spots: a bell every ~4 s → roughly one hit per strike', () => {
    const { hits } = countHits(renderPreset('Bell spots', 16));
    expect(hits).toBeGreaterThanOrEqual(3);
    expect(hits).toBeLessThanOrEqual(6);
  });

  it('Cave coral: ~3 drops/s over a noise bed → many hits', () => {
    const { hits } = countHits(renderPreset('Cave coral', 12));
    expect(hits).toBeGreaterThanOrEqual(12);
    expect(hits).toBeLessThanOrEqual(45);
  });

  it('steady drones don\'t fire much (few false hits)', () => {
    for (const name of ['Stillness ink', 'Wind ash', 'Molten Polivoks']) {
      const { hits } = countHits(renderPreset(name, 12));
      expect(hits, name).toBeLessThanOrEqual(4);
    }
  });

  it('a shimmering pad fires well under once a second (dry; its FX smooth it to ~1 per 20 s)', () => {
    // Aurora's LFO pushes `move` up to ~3 Hz: harmonic amplitudes flicker, a
    // few flickers count as rises. Measured on the full graph (reverb,
    // chorus, LP) with scripts/analyze.mjs renders: 1 hit in 20 s.
    const { hits } = countHits(renderPreset('Aurora', 12));
    expect(hits).toBeLessThanOrEqual(8);
  });

  it('the same pipeline works at a low frame rate (weak devices)', () => {
    const { hits } = countHits(renderPreset('Bell spots', 16), 20);
    expect(hits).toBeGreaterThanOrEqual(3);
    expect(hits).toBeLessThanOrEqual(6);
  });

  it('swell swings visibly on struck/swelling sounds', () => {
    const bells = countHits(renderPreset('Bell spots', 16));
    expect(bells.swellMax).toBeGreaterThan(0.5);
    const wind = countHits(renderPreset('Wind ash', 16));
    expect(wind.swellMax - wind.swellMin).toBeGreaterThan(0.6);
  });
});
