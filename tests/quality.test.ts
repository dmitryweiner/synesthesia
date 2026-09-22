import {
  QUALITY_LADDER, TOP_RUNG, PROBE_BUDGET_MS, backingStore, QualityProbe,
} from '../src/sim/quality';

describe('quality ladder', () => {
  it('climbs in both axes, and only the top rung is uncapped', () => {
    for (let i = 1; i < QUALITY_LADDER.length; i++) {
      const prev = QUALITY_LADDER[i - 1];
      const here = QUALITY_LADDER[i];
      expect(here.res, `res at rung ${i}`).toBeGreaterThan(prev.res);
      if (here.maxSide !== 0) expect(here.maxSide, `maxSide at rung ${i}`).toBeGreaterThan(prev.maxSide);
    }
    expect(QUALITY_LADDER[TOP_RUNG].maxSide).toBe(0);
    expect(QUALITY_LADDER.filter((r) => r.maxSide === 0)).toHaveLength(1);
  });

  it('the top rung is what the app did before auto-tuning: full dpr, res 1024', () => {
    expect(QUALITY_LADDER[TOP_RUNG].res).toBe(1024);
  });
});

describe('backingStore', () => {
  it('uncapped (maxSide 0) = CSS size × devicePixelRatio', () => {
    expect(backingStore(0, 960, 540, 2)).toEqual({ width: 1920, height: 1080 });
  });

  it('leaves a store that already fits alone', () => {
    expect(backingStore(1280, 800, 600, 1)).toEqual({ width: 800, height: 600 });
  });

  it('caps the LONG side and keeps the aspect — landscape and portrait alike', () => {
    const land = backingStore(1280, 1920, 1080, 1);
    expect(land.width).toBe(1280);
    expect(land.height / land.width).toBeCloseTo(1080 / 1920, 2);

    const port = backingStore(1280, 1080, 2400, 1);
    expect(port.height).toBe(1280);
    expect(port.width / port.height).toBeCloseTo(1080 / 2400, 2);
  });

  it('the cap is in device pixels, so a retina screen is downscaled too', () => {
    expect(backingStore(1280, 1024, 768, 2)).toEqual({ width: 1280, height: 960 });
  });

  it('never returns a zero or fractional side', () => {
    const tiny = backingStore(640, 0, 0, 1);
    expect(tiny.width).toBeGreaterThanOrEqual(1);
    expect(tiny.height).toBeGreaterThanOrEqual(1);
    const thin = backingStore(64, 4000, 3, 1);
    expect(Number.isInteger(thin.width)).toBe(true);
    expect(thin.height).toBeGreaterThanOrEqual(1);
  });
});

// The probe walks UP from the cheapest rung: the worst case is then one
// frame of the rung above the machine's ceiling (~2× the budget), not one
// frame of the top rung (2.6 s on a software rasterizer).
describe('QualityProbe', () => {
  const opts = { warmup: 1, samples: 3, budgetMs: 50, abortFactor: 3 };
  /** Feeds `ms` until the probe leaves `rung` or finishes; returns the rung it moved to. */
  const feed = (p: QualityProbe, ms: number, n = 12): number => {
    for (let i = 0; i < n; i++) {
      const at = p.rung;
      if (p.frame(ms) || p.done) return p.rung;
      expect(p.rung).toBe(at);
    }
    throw new Error(`probe stuck at rung ${p.rung}`);
  };

  it('a fast machine climbs to the top and stops there', () => {
    const p = new QualityProbe(opts);
    expect(p.rung).toBe(0);
    for (let r = 0; r < TOP_RUNG; r++) expect(feed(p, 8)).toBe(r + 1);
    feed(p, 8);
    expect(p.done).toBe(true);
    expect(p.rung).toBe(TOP_RUNG);
  });

  it('ignores warm-up frames after every rung change', () => {
    const p = new QualityProbe({ ...opts, warmup: 2, samples: 2 });
    p.frame(9999); // reallocation right after the rung was applied
    p.frame(9999);
    expect(p.done).toBe(false);
    expect(p.rung).toBe(0);
    expect(p.frame(5)).toBe(false);
    expect(p.frame(5)).toBe(true); // 2 real samples, both fast → rung 1
    expect(p.rung).toBe(1);
  });

  it('stops one rung below the first that misses the budget', () => {
    const p = new QualityProbe(opts);
    feed(p, 10);            // rung 0 passes → rung 1
    feed(p, 20);            // rung 1 passes → rung 2
    feed(p, 120);           // rung 2 misses
    expect(p.done).toBe(true);
    expect(p.rung).toBe(1);
  });

  it('a catastrophic frame fails the rung without waiting for a full sample', () => {
    const p = new QualityProbe(opts);
    feed(p, 10);
    expect(p.rung).toBe(1);
    p.frame(10);            // warm-up
    p.frame(10);            // one good sample, so the next one is believed
    expect(p.frame(2600)).toBe(true);
    expect(p.done).toBe(true);
    expect(p.rung).toBe(0);
  });

  it('forgives the first frame of a rung, so a boot hiccup cannot pin a fast machine', () => {
    const p = new QualityProbe(opts);
    p.frame(10);            // warm-up
    p.frame(5000);          // a GC pause, a morph, the point loading — not the rung
    expect(p.done).toBe(false);
    p.frame(8);
    expect(p.frame(8)).toBe(true);
    expect(p.rung).toBe(1); // median of [5000, 8, 8] = 8 → the rung stands
  });

  it('a machine too slow even for the cheapest rung settles on it rather than going below', () => {
    const p = new QualityProbe(opts);
    feed(p, 4000);
    expect(p.done).toBe(true);
    expect(p.rung).toBe(0);
  });

  it('judges a rung by the median, so one hitch does not demote it', () => {
    const p = new QualityProbe({ ...opts, samples: 5 });
    p.frame(10); // warm-up
    p.frame(10);
    p.frame(140);
    p.frame(10);
    p.frame(10);
    expect(p.frame(10)).toBe(true);
    expect(p.rung).toBe(1);
  });

  it('the default budget leaves room for the audio thread under the 15 fps floor', () => {
    expect(PROBE_BUDGET_MS).toBeLessThan(1000 / 15);
  });
});
