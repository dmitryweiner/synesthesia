import { GENES, GENE_INDEX, ROUTE_SLOTS, MOD_TARGETS, geneById, geneValue, geneFromValue, isGeneActive } from '../src/genome/genes';
import { encodeGenome, decodeGenome, genomeLength } from '../src/genome/codec';
import { defaultAppState, stateToAppState } from '../src/state/schema';
import { FORMULA_IDS } from '../src/dsp/generator';

describe('genes', () => {
  it('ids are unique and indexed', () => {
    const ids = GENES.map((g) => g.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (let i = 0; i < GENES.length; i++) expect(GENE_INDEX.get(GENES[i].id)).toBe(i);
    expect(genomeLength()).toBe(GENES.length);
  });

  it('covers formulas, fx, cards, lfos, route slots and coupling', () => {
    for (const id of FORMULA_IDS) expect(geneById(`a.${id}.enabled`)?.kind).toBe('bool');
    expect(geneById('a.fm.fc')?.exp).toBe(true);
    expect(geneById('a.fm.fc')?.activeIf).toBe('a.fm.enabled');
    expect(geneById('a.fm.gain')?.kind).toBe('cont');
    expect(geneById('fx.filterOn')?.kind).toBe('bool');
    expect(geneById('fx.filterFreq')?.activeIf).toBe('fx.filterOn');
    expect(geneById('fx.filterType')?.kind).toBe('choice');
    expect(geneById('fx.phaserStages')?.kind).toBe('choice');
    expect(geneById('fx.reverbDecay')?.kind).toBe('cont');
    expect(geneById('v.flow.on')?.kind).toBe('bool');
    expect(geneById('v.flow.curlStrength')?.activeIf).toBe('v.flow.on');
    expect(geneById('v.reaction.feed')?.activeIf).toBeUndefined();
    expect(geneById('v.palette.paletteId')?.kind).toBe('choice');
    expect(geneById('lfo.0.shape')?.kind).toBe('choice');
    expect(geneById('lfo.3.rate')?.exp).toBe(true);
    for (let i = 0; i < ROUTE_SLOTS; i++) {
      expect(geneById(`route.${i}.on`)?.kind).toBe('bool');
      expect(geneById(`route.${i}.target`)?.max).toBe(MOD_TARGETS.length - 1);
      expect(geneById(`route.${i}.depth`)?.activeIf).toBe(`route.${i}.on`);
    }
    expect(geneById('c.loudToFlow')?.min).toBe(-1);
    expect(geneById('c.onsetToSeed')?.min).toBe(0);
    expect(geneById('c.onsetToSeed')?.max).toBe(1);
    expect(geneById('c.spectrumToTint')?.kind).toBe('cont');
  });

  it('every activeIf points at an existing bool gene', () => {
    for (const g of GENES) {
      if (!g.activeIf) continue;
      expect(geneById(g.activeIf)?.kind, g.id).toBe('bool');
    }
  });

  it('MOD_TARGETS include audio sliders, fx params and visual sliders', () => {
    const keys = MOD_TARGETS.map((t) => `${t.target}.${t.param}`);
    expect(keys).toContain('fm.fc');
    expect(keys).toContain('fx.filterFreq');
    expect(keys).toContain('reaction.feed');
    expect(keys).not.toContain('palette.paletteId');
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('geneValue/geneFromValue round-trip linear and exp genes', () => {
    const lin = geneById('a.fm.I')!;
    expect(geneValue(lin, 0)).toBe(lin.min);
    expect(geneValue(lin, 1)).toBe(lin.max);
    expect(geneFromValue(lin, 10)).toBeCloseTo(0.5, 12);
    const exp = geneById('a.fm.fc')!;
    expect(geneValue(exp, 0)).toBeCloseTo(20, 9);
    expect(geneValue(exp, 1)).toBeCloseTo(2000, 9);
    expect(geneValue(exp, 0.5)).toBeCloseTo(200, 9); // geometric midpoint
    expect(geneFromValue(exp, geneValue(exp, 0.3))).toBeCloseTo(0.3, 12);
    expect(geneFromValue(exp, 1e9)).toBe(1); // clamped
  });

  it('isGeneActive follows the gate', () => {
    const g = encodeGenome(defaultAppState());
    expect(isGeneActive(g, GENE_INDEX.get('a.fm.fc')!)).toBe(false);
    g[GENE_INDEX.get('a.fm.enabled')!] = 1;
    expect(isGeneActive(g, GENE_INDEX.get('a.fm.fc')!)).toBe(true);
    expect(isGeneActive(g, GENE_INDEX.get('v.reaction.feed')!)).toBe(true);
  });
});

describe('codec', () => {
  it('decode(encode(state)) reproduces the state (continuous within 1e-9)', () => {
    const s = stateToAppState({
      presetName: 'P',
      audio: {
        masterGain: 0.6,
        fx: { filterOn: true, filterType: 'peaking', filterFreq: 333, phaserOn: true, phaserStages: 6, chorusMode: 'flanger', reverbDecay: 4.4 },
        formulas: { fm: { enabled: true, params: { fc: 333, I: 7.25 } }, rain: { enabled: true, params: { rainPitch: 1234 } } },
      },
      visual: { cards: { flow: { on: true, params: { curlStrength: 0.012, driftY: -0.004 } }, palette: { params: { paletteId: 3, bands: 2 } } } },
      mod: {
        lfos: [
          { shape: 'saw', rate: 0.02, phase: 0.3 }, { shape: 'random', rate: 0.5, phase: 0 },
          { shape: 'sine', rate: 0.05, phase: 0 }, { shape: 'sine', rate: 0.05, phase: 0 },
        ],
        routes: [
          { src: 1, target: 'fm', param: 'fc', depth: 0.3, exp: true },
          { src: 0, target: 'fx', param: 'filterFreq', depth: -0.5 },
          { src: 2, target: 'reaction', param: 'feed', depth: 0.2 },
        ],
      },
      coupling: { loudToFlow: 0.7, onsetToLight: -0.3 },
    });
    const back = decodeGenome(encodeGenome(s));
    // presetName / masterGain are not genes: decode returns defaults for them.
    expect(back.presetName).toBeUndefined();
    back.presetName = s.presetName;
    back.audio.masterGain = s.audio.masterGain;
    expect(back.audio.fx.filterType).toBe('peaking');
    expect(back.audio.fx.chorusMode).toBe('flanger');
    expect(back.audio.fx.phaserStages).toBe(6);
    expect(back.audio.formulas.fm.enabled).toBe(true);
    expect(back.audio.formulas.fm.params.fc).toBeCloseTo(333, 9);
    expect(back.audio.formulas.fm.params.I).toBeCloseTo(7.25, 9);
    expect(back.visual.cards.flow.on).toBe(true);
    expect(back.visual.cards.flow.params.driftY).toBeCloseTo(-0.004, 12);
    expect(back.visual.cards.palette.params.paletteId).toBe(3);
    expect(back.visual.cards.palette.params.bands).toBe(2);
    expect(back.mod.lfos[0]).toEqual({ shape: 'saw', rate: expect.closeTo(0.02, 9), phase: expect.closeTo(0.3, 9) });
    expect(back.mod.routes).toEqual([
      { src: 1, target: 'fm', param: 'fc', depth: expect.closeTo(0.3, 9), exp: true },
      { src: 0, target: 'fx', param: 'filterFreq', depth: expect.closeTo(-0.5, 9) },
      { src: 2, target: 'reaction', param: 'feed', depth: expect.closeTo(0.2, 9) },
    ]);
    expect(back.coupling.loudToFlow).toBeCloseTo(0.7, 9);
    expect(back.coupling.onsetToLight).toBeCloseTo(-0.3, 9);
    // Then encode again: genome is stable (up to float round-off on exp genes).
    const g1 = encodeGenome(s);
    const g2 = encodeGenome(back);
    expect(g2.length).toBe(g1.length);
    for (let i = 0; i < g1.length; i++) expect(g2[i], GENES[i].id).toBeCloseTo(g1[i], 9);
  });

  it('integer-step sliders decode to integers', () => {
    const g = encodeGenome(defaultAppState());
    g[GENE_INDEX.get('a.additive.N')!] = 0.3777;
    g[GENE_INDEX.get('v.palette.bands')!] = 0.61;
    const s = decodeGenome(g);
    expect(Number.isInteger(s.audio.formulas.additive.params.N)).toBe(true);
    expect(Number.isInteger(s.visual.cards.palette.params.bands)).toBe(true);
  });

  it('routes beyond ROUTE_SLOTS are dropped; routes with an unknown target are dropped', () => {
    const s = defaultAppState();
    for (let i = 0; i < ROUTE_SLOTS + 3; i++) s.mod.routes.push({ src: 0, target: 'fm', param: 'fc', depth: 0.1 });
    s.mod.routes.push({ src: 0, target: 'nope', param: 'x', depth: 0.1 });
    expect(decodeGenome(encodeGenome(s)).mod.routes).toHaveLength(ROUTE_SLOTS);
  });

  it('every gene value stays in [min, max] after encoding defaults', () => {
    const g = encodeGenome(defaultAppState());
    for (let i = 0; i < g.length; i++) {
      const d = GENES[i];
      const lo = d.kind === 'cont' ? 0 : d.min;
      const hi = d.kind === 'cont' ? 1 : d.max;
      expect(g[i], d.id).toBeGreaterThanOrEqual(lo);
      expect(g[i], d.id).toBeLessThanOrEqual(hi);
    }
  });
});
