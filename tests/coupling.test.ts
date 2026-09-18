import { applyCoupling, COUPLING_DEFS } from '../src/coupling';
import { COUPLING_KEYS, defaultAppState } from '../src/state/schema';
import { SILENT_FEATURES } from '../src/audio/features';
import { cardDef } from '../src/schema/visual';

function cards() {
  const s = defaultAppState();
  const out: Record<string, Record<string, number>> = {};
  for (const [id, c] of Object.entries(s.visual.cards)) out[id] = { ...c.params };
  return out;
}

function zeroCoupling() {
  const c: Record<string, number> = {};
  for (const k of COUPLING_KEYS) c[k] = 0;
  return c;
}

describe('coupling', () => {
  it('every coupling key has a definition', () => {
    expect(COUPLING_DEFS.map((d) => d.key).sort()).toEqual([...COUPLING_KEYS].sort());
  });

  it('zero coupling or silent features → params unchanged (but cloned)', () => {
    const base = cards();
    const a = applyCoupling(base, { loudness: 1, brightness: 1, onset: 1 }, zeroCoupling());
    expect(a).toEqual(base);
    expect(a).not.toBe(base);
    const c = zeroCoupling();
    c.loudToFlow = 1;
    expect(applyCoupling(base, SILENT_FEATURES, c)).toEqual(base);
  });

  it('loudness pushes advection/curl/gloss, clamped to slider ranges', () => {
    const base = cards();
    const c = zeroCoupling();
    c.loudToFlow = 1; c.loudToCurl = 1; c.loudToGloss = 1;
    const out = applyCoupling(base, { loudness: 1, brightness: 0.5, onset: 0 }, c);
    expect(out.flow.advectAmount).toBeGreaterThan(base.flow.advectAmount);
    expect(out.flow.curlStrength).toBeGreaterThan(base.flow.curlStrength);
    expect(out.palette.gloss).toBeGreaterThan(base.palette.gloss);
    const gloss = cardDef('palette')!.sliders.find((s) => s.k === 'gloss')!;
    expect(out.palette.gloss).toBeLessThanOrEqual(gloss.max);
    const adv = cardDef('flow')!.sliders.find((s) => s.k === 'advectAmount')!;
    expect(out.flow.advectAmount).toBeLessThanOrEqual(adv.max);
    // negative coupling pulls the other way
    c.loudToGloss = -1;
    expect(applyCoupling(base, { loudness: 1, brightness: 0.5, onset: 0 }, c).palette.gloss).toBeLessThan(base.palette.gloss);
  });

  it('brightness shifts the palette hue cyclically; onsets rotate the light', () => {
    const base = cards();
    const c = zeroCoupling();
    c.brightToShift = 1; c.onsetToLight = 1;
    const hi = applyCoupling(base, { loudness: 0, brightness: 1, onset: 1 }, c);
    expect(hi.palette.shift).not.toBe(base.palette.shift);
    expect(hi.palette.shift).toBeGreaterThanOrEqual(0);
    expect(hi.palette.shift).toBeLessThan(1);
    expect(hi.palette.lightAngle).not.toBe(base.palette.lightAngle);
    expect(hi.palette.lightAngle).toBeGreaterThanOrEqual(0);
    expect(hi.palette.lightAngle).toBeLessThan(2 * Math.PI);
    // brightness at its midpoint is neutral
    expect(applyCoupling(base, { loudness: 0, brightness: 0.5, onset: 0 }, c).palette.shift).toBeCloseTo(base.palette.shift, 12);
  });
});
