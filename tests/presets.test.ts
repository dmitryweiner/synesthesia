// Every built-in preset must be a fully valid point: it survives the
// sanitize/clamp round trip unchanged, round-trips through the genome,
// actually makes sound, and links sound to image (routes or coupling).
import * as presetsModule from '../src/presets';
import { PRESETS, DEFAULT_PRESET_INDEX } from '../src/presets';
import { sanitizeState, stateToAppState, COUPLING_KEYS, EXPLICIT_COUPLING_KEYS, COUPLING_FLOOR, isModTarget } from '../src/state/schema';
import { encodeGenome, decodeGenome } from '../src/genome/codec';
import { GENES, ROUTE_SLOTS } from '../src/genome/genes';
import { enabledFormulaCount, isValidGenome } from '../src/genome/evolve';
import { FormulaGenerator, FORMULA_IDS } from '../src/dsp/generator';
import { FORMULAS, MAX_ENABLED_FORMULAS } from '../src/schema/audio';
import { buildModPayload } from '../src/audio/modrouting';
import { mulberry32 } from '../src/dsp/rng';
import { CARDS } from '../src/schema/visual';

const SR = 48000;
const BLOCK = 128;

function renderInto(gen: FormulaGenerator, mix: Float32Array): void {
  const buf = new Float32Array(BLOCK);
  for (let i = 0; i < mix.length; i += BLOCK) {
    gen.fill(buf);
    for (let j = 0; j < BLOCK && i + j < mix.length; j++) mix[i + j] += buf[j];
  }
}

describe('presets: catalogue', () => {
  it('ships no temporary VARIANTS (drafts rendered by analyze.mjs while designing a preset)', () => {
    expect(Object.keys(presetsModule)).not.toContain('VARIANTS');
  });

  it('at least 8, unique names, default index valid', () => {
    expect(PRESETS.length).toBeGreaterThanOrEqual(8);
    expect(new Set(PRESETS.map((p) => p.name)).size).toBe(PRESETS.length);
    expect(PRESETS[DEFAULT_PRESET_INDEX]).toBeDefined();
    for (const p of PRESETS) expect(p.state.presetName).toBe(p.name);
  });
});

describe.each(PRESETS.map((p) => [p.name, p] as const))('preset %s', (_name, preset) => {
  const s = preset.state;

  it('survives sanitize + clamp unchanged (every value in range, nothing dropped)', () => {
    const back = stateToAppState(sanitizeState(JSON.parse(JSON.stringify(s))) ?? {});
    expect(back).toEqual(s);
  });

  it('has 1..MAX formulas enabled and every card present', () => {
    const n = Object.values(s.audio.formulas).filter((f) => f.enabled).length;
    expect(n).toBeGreaterThanOrEqual(1);
    expect(n).toBeLessThanOrEqual(MAX_ENABLED_FORMULAS);
    expect(Object.keys(s.visual.cards)).toEqual(CARDS.map((c) => c.id));
  });

  it('routes fit the genome slots and point at real targets', () => {
    expect(s.mod.routes.length).toBeLessThanOrEqual(ROUTE_SLOTS);
    for (const r of s.mod.routes) {
      expect(isModTarget(r.target, r.param), `${r.target}.${r.param}`).toBe(true);
      expect(r.src).toBeLessThan(s.mod.lfos.length);
    }
  });

  it('links sound and image: a visual route or a non-zero coupling', () => {
    const visualRoute = s.mod.routes.some((r) => CARDS.some((c) => c.id === r.target));
    const coupled = COUPLING_KEYS.some((k) => s.coupling[k] !== 0);
    expect(visualRoute || coupled).toBe(true);
  });

  it('explicit sound→image couplings meet the floor (pulse, flash, seeds, tint)', () => {
    const sum = EXPLICIT_COUPLING_KEYS.reduce((a, k) => a + s.coupling[k], 0);
    expect(sum).toBeGreaterThanOrEqual(COUPLING_FLOOR);
  });

  it('round-trips through the genome', () => {
    const g = encodeGenome(s);
    expect(isValidGenome(g)).toBe(true);
    expect(enabledFormulaCount(g)).toBeGreaterThanOrEqual(1);
    const back = decodeGenome(g);
    expect(back.audio.fx.filterType).toBe(s.audio.fx.filterType);
    expect(back.mod.routes.length).toBe(s.mod.routes.length);
    for (const id of FORMULA_IDS) expect(back.audio.formulas[id].enabled).toBe(s.audio.formulas[id].enabled);
    const g2 = encodeGenome(back);
    for (let i = 0; i < g.length; i++) expect(g2[i], GENES[i].id).toBeCloseTo(g[i], 9);
  });

  it('sounds: enabled generators (with modulation) are finite, audible, not blowing up', () => {
    const mix = new Float32Array(SR);
    let i = 0;
    for (const [id, snap] of Object.entries(s.audio.formulas)) {
      if (!snap.enabled) continue;
      const fid = FORMULA_IDS.find((f) => f === id);
      if (!fid) continue;
      const gen = new FormulaGenerator(fid, SR, snap.params, mulberry32(100 + i++));
      const p = buildModPayload(s.mod, fid, FORMULAS);
      gen.setMod(p.lfos, p.routes, p.ranges);
      renderInto(gen, mix);
    }
    let peak = 0, sumSq = 0, finite = true;
    for (const v of mix) {
      if (!Number.isFinite(v)) finite = false;
      peak = Math.max(peak, Math.abs(v));
      sumSq += v * v;
    }
    expect(finite).toBe(true);
    expect(Math.sqrt(sumSq / mix.length)).toBeGreaterThan(1e-4);
    expect(peak).toBeLessThanOrEqual(8);
  });
});
