import { mutate, repair, randomGenome, diffDims, lerpGenome, enabledFormulaCount, diffSummary, isValidGenome } from '../src/genome/evolve';
import { GENES, GENE_INDEX } from '../src/genome/genes';
import { encodeGenome, decodeGenome } from '../src/genome/codec';
import { defaultAppState } from '../src/state/schema';
import { mulberry32 } from '../src/dsp/rng';
import { MAX_ENABLED_FORMULAS } from '../src/schema/audio';
import { EXPLICIT_COUPLING_KEYS, COUPLING_FLOOR } from '../src/state/schema';

function explicitSum(g: number[]): number {
  return EXPLICIT_COUPLING_KEYS.reduce((a, k) => a + decodeGenome(g).coupling[k], 0);
}

function base() {
  const s = defaultAppState();
  s.audio.formulas.fm.enabled = true;
  s.audio.formulas.additive.enabled = true;
  s.visual.cards.flow.on = true;
  return encodeGenome(s);
}

const contIdx = GENES.map((g, i) => (g.kind === 'cont' ? i : -1)).filter((i) => i >= 0);

describe('mutate (continuous, no structural)', () => {
  it('changes at most k active continuous genes, all within [0,1]', () => {
    const g = base();
    const rng = mulberry32(1);
    for (let trial = 0; trial < 50; trial++) {
      const m = mutate(g, rng, { sigma: 0.1, k: 4, structuralProb: 0 });
      const changed = diffDims(g, m);
      expect(changed.length).toBeLessThanOrEqual(4);
      for (const i of changed) {
        expect(GENES[i].kind).toBe('cont');
        expect(m[i]).toBeGreaterThanOrEqual(0);
        expect(m[i]).toBeLessThanOrEqual(1);
      }
    }
  });

  it('never touches inactive genes (disabled formula params, off card params, unused route slots)', () => {
    const g = base();
    const rng = mulberry32(2);
    const inactive = new Set<number>();
    for (let i = 0; i < GENES.length; i++) {
      const a = GENES[i].activeIf;
      if (a && g[GENE_INDEX.get(a)!] === 0) inactive.add(i);
    }
    expect(inactive.size).toBeGreaterThan(50);
    for (let trial = 0; trial < 200; trial++) {
      const m = mutate(g, rng, { sigma: 0.2, k: 6, structuralProb: 0 });
      for (const i of diffDims(g, m)) expect(inactive.has(i), GENES[i].id).toBe(false);
    }
  });

  it('respects the avoid set', () => {
    const g = base();
    const rng = mulberry32(3);
    const avoid = new Set(contIdx.filter((i) => GENES[i].group === 'a.fm'));
    for (let trial = 0; trial < 100; trial++) {
      const m = mutate(g, rng, { sigma: 0.2, k: 6, structuralProb: 0, avoid });
      for (const i of diffDims(g, m)) expect(avoid.has(i)).toBe(false);
    }
  });

  it('momentum shifts every continuous gene it names, in its direction', () => {
    const g = base();
    const momentum = new Array(g.length).fill(0);
    const fc = GENE_INDEX.get('a.fm.fc')!;
    const I = GENE_INDEX.get('a.fm.I')!;
    momentum[fc] = 0.1;
    momentum[I] = -0.1;
    const m = mutate(g, mulberry32(4), { sigma: 0, k: 0, structuralProb: 0, momentum, momentumWeight: 0.5 });
    expect(m[fc]).toBeCloseTo(g[fc] + 0.05, 12);
    expect(m[I]).toBeCloseTo(g[I] - 0.05, 12);
    expect(diffDims(g, m).sort()).toEqual([fc, I].sort());
  });

  it('does not mutate the input', () => {
    const g = base();
    const copy = [...g];
    mutate(g, mulberry32(5), { sigma: 0.3, k: 8, structuralProb: 1 });
    expect(g).toEqual(copy);
  });
});

describe('mutate (structural)', () => {
  it('with structuralProb=1 a discrete gene changes (over many trials, several kinds appear)', () => {
    const g = base();
    const rng = mulberry32(6);
    const kinds = new Set<string>();
    for (let trial = 0; trial < 300; trial++) {
      const m = mutate(g, rng, { sigma: 0, k: 0, structuralProb: 1 });
      const changed = diffDims(g, m).filter((i) => GENES[i].kind !== 'cont');
      expect(changed.length).toBeGreaterThan(0);
      for (const i of changed) kinds.add(GENES[i].group.split('.')[0]);
    }
    expect(kinds.has('a')).toBe(true);   // formula toggles
    expect(kinds.has('fx')).toBe(true);
    expect(kinds.has('v')).toBe(true);
    expect(kinds.has('route')).toBe(true);
  });

  it('turning a route slot on also randomizes its target and depth', () => {
    const g = base();
    const rng = mulberry32(7);
    let sawOn = false;
    for (let trial = 0; trial < 400 && !sawOn; trial++) {
      const m = mutate(g, rng, { sigma: 0, k: 0, structuralProb: 1 });
      for (let slot = 0; slot < 10; slot++) {
        const on = GENE_INDEX.get(`route.${slot}.on`)!;
        if (g[on] === 0 && m[on] === 1) {
          sawOn = true;
          const depth = GENE_INDEX.get(`route.${slot}.depth`)!;
          expect(m[depth]).not.toBe(g[depth]);
        }
      }
    }
    expect(sawOn).toBe(true);
  });
});

describe('repair / validity', () => {
  it('no formulas → one enabled; too many → trimmed to MAX', () => {
    const none = encodeGenome(defaultAppState());
    expect(enabledFormulaCount(none)).toBe(0);
    expect(enabledFormulaCount(repair(none, mulberry32(1)))).toBe(1);
    const s = defaultAppState();
    for (const f of Object.values(s.audio.formulas)) f.enabled = true;
    const all = encodeGenome(s);
    expect(enabledFormulaCount(repair(all, mulberry32(1)))).toBe(MAX_ENABLED_FORMULAS);
  });

  it('repair lifts the explicit sound→image couplings to the floor (and leaves them alone above it)', () => {
    const g = base();
    for (const k of EXPLICIT_COUPLING_KEYS) g[GENE_INDEX.get(`c.${k}`)!] = 0;
    const r = repair(g, mulberry32(9));
    expect(explicitSum(r)).toBeGreaterThanOrEqual(COUPLING_FLOOR - 1e-9);
    // proportions kept when scaling up a weak but non-zero mix
    const w = base();
    const [a, b] = EXPLICIT_COUPLING_KEYS;
    for (const k of EXPLICIT_COUPLING_KEYS) w[GENE_INDEX.get(`c.${k}`)!] = 0;
    w[GENE_INDEX.get(`c.${a}`)!] = 0.2;
    w[GENE_INDEX.get(`c.${b}`)!] = 0.1;
    const rw = repair(w, mulberry32(9));
    expect(explicitSum(rw)).toBeGreaterThanOrEqual(COUPLING_FLOOR - 1e-9);
    expect(rw[GENE_INDEX.get(`c.${a}`)!]).toBeGreaterThan(rw[GENE_INDEX.get(`c.${b}`)!]);
    const strong = base();
    for (const k of EXPLICIT_COUPLING_KEYS) strong[GENE_INDEX.get(`c.${k}`)!] = 0.9;
    expect(repair(strong, mulberry32(9))).toEqual(strong);
  });

  it('isValidGenome: length and ranges', () => {
    expect(isValidGenome(base())).toBe(true);
    expect(isValidGenome([1, 2, 3])).toBe(false);
    const bad = base();
    bad[0] = 7;
    expect(isValidGenome(bad)).toBe(false);
  });

  it('randomGenome is valid, decodable and has 1..MAX formulas', () => {
    for (let seed = 0; seed < 20; seed++) {
      const g = randomGenome(mulberry32(seed));
      expect(isValidGenome(g)).toBe(true);
      const n = enabledFormulaCount(g);
      expect(n).toBeGreaterThanOrEqual(1);
      expect(n).toBeLessThanOrEqual(MAX_ENABLED_FORMULAS);
      expect(() => decodeGenome(g)).not.toThrow();
      expect(explicitSum(g)).toBeGreaterThanOrEqual(COUPLING_FLOOR - 1e-9);
    }
  });
});

describe('lerpGenome', () => {
  it('t=0 → a, t=1 → b; continuous genes interpolate, discrete switch as soon as t>0', () => {
    const a = base();
    const b = [...a];
    const fc = GENE_INDEX.get('a.fm.fc')!;
    const pal = GENE_INDEX.get('v.palette.paletteId')!;
    b[fc] = a[fc] + 0.4;
    b[pal] = 3;
    expect(lerpGenome(a, b, 0)).toEqual(a);
    expect(lerpGenome(a, b, 1)).toEqual(b);
    const mid = lerpGenome(a, b, 0.5);
    expect(mid[fc]).toBeCloseTo(a[fc] + 0.2, 12);
    expect(mid[pal]).toBe(3);
    expect(lerpGenome(a, b, 0.01)[pal]).toBe(3);
  });
});

describe('diffSummary', () => {
  it('lists changed genes with human-readable direction', () => {
    const a = base();
    const b = [...a];
    b[GENE_INDEX.get('a.fm.fc')!] += 0.2;
    b[GENE_INDEX.get('v.flow.on')!] = 0;
    const d = diffSummary(a, b);
    expect(d.map((x) => x.id).sort()).toEqual(['a.fm.fc', 'v.flow.on']);
    expect(d.find((x) => x.id === 'a.fm.fc')?.dir).toBe('up');
    expect(d.find((x) => x.id === 'v.flow.on')?.dir).toBe('off');
  });
});

describe('lerpGenome: gate-aware fades', () => {
  const ON = GENE_INDEX.get('a.rain.enabled')!;
  const GAIN = GENE_INDEX.get('a.rain.gain')!;
  const PITCH = GENE_INDEX.get('a.rain.rainPitch')!;

  it('a formula switching ON fades its gain in from 0 (gate opens at t>0)', () => {
    const a = base();
    const b = [...a];
    a[GAIN] = 0.6; // stale value left in the disabled formula
    b[ON] = 1;
    b[GAIN] = 0.4;
    const mid = lerpGenome(a, b, 0.5);
    expect(mid[ON]).toBe(1);
    expect(mid[GAIN]).toBeCloseTo(0.2, 12); // halfway from neutral 0, not from the stale 0.6
    expect(lerpGenome(a, b, 1)).toEqual(b);
  });

  it('a formula switching OFF fades its gain out and closes the gate only at t=1', () => {
    const a = base();
    const FM_ON = GENE_INDEX.get('a.fm.enabled')!;
    const FM_GAIN = GENE_INDEX.get('a.fm.gain')!;
    const b = [...a];
    b[FM_ON] = 0;
    const mid = lerpGenome(a, b, 0.5);
    expect(mid[FM_ON]).toBe(1);
    expect(mid[FM_GAIN]).toBeCloseTo(a[FM_GAIN] / 2, 12);
    expect(lerpGenome(a, b, 0.999)[FM_ON]).toBe(1);
    expect(lerpGenome(a, b, 1)[FM_ON]).toBe(0);
  });

  it('a route switching off fades its depth to 0 (normalized 0.5)', () => {
    const a = base();
    const on = GENE_INDEX.get('route.0.on')!;
    const depth = GENE_INDEX.get('route.0.depth')!;
    a[on] = 1;
    a[depth] = 0.9;
    const b = [...a];
    b[on] = 0;
    const mid = lerpGenome(a, b, 0.5);
    expect(mid[on]).toBe(1);
    expect(mid[depth]).toBeCloseTo(0.7, 12);
  });

  it('gated genes without a neutral value just switch/interpolate as before', () => {
    const a = base();
    const b = [...a];
    b[ON] = 1;
    b[PITCH] = a[PITCH] + 0.2;
    expect(lerpGenome(a, b, 0.5)[PITCH]).toBeCloseTo(a[PITCH] + 0.1, 12);
  });
});
