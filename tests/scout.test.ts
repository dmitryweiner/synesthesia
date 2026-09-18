import { Scout, adjustedScore } from '../src/genome/scout';
import type { ScoutRender, ScoutAnalyze } from '../src/genome/scout';
import { Explorer } from '../src/genome/explorer';
import { encodeGenome } from '../src/genome/codec';
import type { Genome } from '../src/genome/codec';
import { GENE_INDEX } from '../src/genome/genes';
import { defaultAppState } from '../src/state/schema';
import type { SoundAnalysis } from '../src/analysis/fractal';
import { mulberry32 } from '../src/dsp/rng';

function start(): Genome {
  const s = defaultAppState();
  s.audio.formulas.fm.enabled = true;
  s.audio.formulas.additive.enabled = true;
  return encodeGenome(s);
}

// Fake engine: the "sound" of a genome is a 1-sample signal carrying a
// score derived from one gene, so tests can predict which candidate wins.
const FC = GENE_INDEX.get('a.fm.fc')!;
const fakeRender: ScoutRender = async (state) => Float32Array.of(state.audio.formulas.fm.params.fc);
function analysisFor(score: number, loudness = -30): SoundAnalysis {
  return { silent: false, loudness, envBeta: 1, centroidBeta: 1, envHiguchi: 1.5, boxDim: 1.6, score };
}
// score = normalized fc gene: higher fc → "more fractal"
const fakeAnalyze: ScoutAnalyze = (samples) => analysisFor(Math.min(1, samples[0] / 2000));

async function settle(scout: Scout): Promise<void> {
  for (let i = 0; i < 50 && scout.busy; i++) await new Promise((r) => setTimeout(r, 0));
}

describe('adjustedScore', () => {
  it('penalizes candidates much quieter than the parent, not louder ones', () => {
    const parent = analysisFor(0.8, -30);
    expect(adjustedScore(analysisFor(0.8, -30), parent)).toBeCloseTo(0.8, 9);
    expect(adjustedScore(analysisFor(0.8, -20), parent)).toBeCloseTo(0.8, 9);
    expect(adjustedScore(analysisFor(0.8, -34), parent)).toBeCloseTo(0.8, 9); // within 6 dB: free
    expect(adjustedScore(analysisFor(0.8, -48), parent)).toBeLessThan(0.6);
    expect(adjustedScore({ ...analysisFor(0, -90), silent: true }, parent)).toBeLessThan(0);
    expect(adjustedScore(analysisFor(0.8, -48), null)).toBeCloseTo(0.8, 9); // no parent yet
  });
});

describe('Scout', () => {
  it('prepares k candidates per direction and hands out the best-scoring one', async () => {
    const ex = new Explorer(start(), { rng: mulberry32(1) });
    const scout = new Scout({ render: fakeRender, analyze: fakeAnalyze, k: 3 });
    scout.prepare(ex);
    await settle(scout);
    expect(scout.ready('like')).toBe(3);
    expect(scout.ready('dislike')).toBe(3);
    const pick = scout.take(ex, 'like');
    expect(pick).not.toBeNull();
    const all = scout.candidates('like').map((c) => c.genome[FC]);
    expect(pick!.genome[FC]).toBe(Math.max(...all));
    expect(pick!.of).toBe(3);
    expect(scout.parent?.score).toBeCloseTo(fakeAnalyze(Float32Array.of(220)).score, 9);
  });

  it('take() returns null when the explorer moved on (stale job) or nothing is ready', async () => {
    const ex = new Explorer(start(), { rng: mulberry32(2) });
    const scout = new Scout({ render: fakeRender, analyze: fakeAnalyze, k: 2 });
    expect(scout.take(ex, 'like')).toBeNull();
    scout.prepare(ex);
    await settle(scout);
    ex.like();
    expect(scout.take(ex, 'like')).toBeNull();
    expect(scout.take(ex, 'dislike')).toBeNull();
  });

  it('a new prepare() cancels the previous job', async () => {
    const ex = new Explorer(start(), { rng: mulberry32(3) });
    let renders = 0;
    const slow: ScoutRender = async (s) => { renders++; await new Promise((r) => setTimeout(r, 5)); return fakeRender(s); };
    const scout = new Scout({ render: slow, analyze: fakeAnalyze, k: 3 });
    scout.prepare(ex);
    ex.like();
    scout.prepare(ex);
    for (let i = 0; i < 100 && scout.busy; i++) await new Promise((r) => setTimeout(r, 5));
    expect(renders).toBeLessThanOrEqual(1 + 7); // ≤1 stray render from the cancelled job
    expect(scout.ready('like')).toBe(3);
    expect(scout.take(ex, 'like')).not.toBeNull();
  });

  it('render failures disable the scout instead of throwing', async () => {
    const ex = new Explorer(start(), { rng: mulberry32(4) });
    const broken: ScoutRender = async () => { throw new Error('no OfflineAudioContext'); };
    const scout = new Scout({ render: broken, analyze: fakeAnalyze, k: 2 });
    scout.prepare(ex);
    await settle(scout);
    expect(scout.disabled).toBe(true);
    expect(scout.take(ex, 'like')).toBeNull();
    scout.prepare(ex); // no-op once disabled
    expect(scout.busy).toBe(false);
  });

  it('renders the parent + k per direction with the given master gain', async () => {
    const ex = new Explorer(start(), { rng: mulberry32(5) });
    const seen: number[] = [];
    const spy: ScoutRender = async (s) => { seen.push(s.audio.masterGain); return fakeRender(s); };
    let progress = 0;
    const scout = new Scout({ render: spy, analyze: fakeAnalyze, k: 1, onProgress: () => progress++ });
    scout.prepare(ex, 0.33);
    await settle(scout);
    expect(seen.length).toBe(3);
    expect(progress).toBe(3);
    for (const g of seen) expect(g).toBe(0.33);
  });
});
