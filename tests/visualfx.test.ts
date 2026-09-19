import { displayCoupling, RippleSet, NEUTRAL_DISPLAY, MAX_RIPPLES, RIPPLE_LIFE } from '../src/visualFx';
import { defaultCoupling, EXPLICIT_COUPLING_KEYS } from '../src/state/schema';
import type { AudioFeatures } from '../src/audio/features';
import { SILENT_FEATURES } from '../src/audio/features';

function features(over: Partial<AudioFeatures>): AudioFeatures {
  return { ...SILENT_FEATURES, ...over };
}

function coupling(over: Record<string, number>): Record<string, number> {
  const c: Record<string, number> = { ...defaultCoupling() };
  for (const k of EXPLICIT_COUPLING_KEYS) c[k] = 0;
  return { ...c, ...over };
}

describe('displayCoupling', () => {
  it('silence or zero coupling → neutral display', () => {
    expect(displayCoupling(SILENT_FEATURES, defaultCoupling())).toEqual(NEUTRAL_DISPLAY);
    const loud = features({ loudness: 1, swell: 1, onset: 1, low: 1, mid: 1, high: 1 });
    expect(displayCoupling(loud, coupling({}))).toEqual(NEUTRAL_DISPLAY);
  });

  it('pulse: exposure follows swell, both ways, and scales with the gene', () => {
    const up = displayCoupling(features({ swell: 1 }), coupling({ loudToPulse: 1 }));
    const down = displayCoupling(features({ swell: -1 }), coupling({ loudToPulse: 1 }));
    const half = displayCoupling(features({ swell: 1 }), coupling({ loudToPulse: 0.5 }));
    expect(up.exposure).toBeGreaterThan(1.2);
    expect(down.exposure).toBeLessThan(0.8);
    expect(down.exposure).toBeGreaterThan(0);
    expect(half.exposure - 1).toBeCloseTo((up.exposure - 1) / 2, 9);
  });

  it('flash follows the onset envelope', () => {
    expect(displayCoupling(features({ onset: 1 }), coupling({ onsetToFlash: 1 })).flash).toBeCloseTo(1, 9);
    expect(displayCoupling(features({ onset: 0.5 }), coupling({ onsetToFlash: 0.5 })).flash).toBeCloseTo(0.25, 9);
  });

  it('tint: bass / mid / treble energy × gene, per band', () => {
    const d = displayCoupling(features({ low: 1, mid: 0.5, high: 0 }), coupling({ spectrumToTint: 0.8 }));
    expect(d.tint[0]).toBeCloseTo(0.8, 9);
    expect(d.tint[1]).toBeCloseTo(0.4, 9);
    expect(d.tint[2]).toBe(0);
  });
});

describe('RippleSet', () => {
  it('adds ripples, ages them, drops expired ones', () => {
    const r = new RippleSet();
    r.add(0.2, 0.3, 0.8, 10);
    const a = r.active(10.5);
    expect(a).toEqual([{ x: 0.2, y: 0.3, age: 0.5, amp: 0.8 }]);
    expect(r.active(10 + RIPPLE_LIFE + 0.01)).toEqual([]);
  });

  it(`keeps at most ${MAX_RIPPLES} (oldest dropped first)`, () => {
    const r = new RippleSet();
    for (let i = 0; i < MAX_RIPPLES + 2; i++) r.add(i / 10, 0.5, 1, i * 0.01);
    const a = r.active(0.1);
    expect(a.length).toBe(MAX_RIPPLES);
    expect(a[0].x).toBeCloseTo(0.2, 9);
  });

  it('packs into a flat uniform array (x, y, age, amp) × MAX_RIPPLES', () => {
    const r = new RippleSet();
    r.add(0.1, 0.2, 0.5, 0);
    const packed = r.pack(0.25);
    expect(packed.length).toBe(MAX_RIPPLES * 4);
    expect(Array.from(packed.slice(0, 4))).toEqual([0.1, 0.2, 0.25, 0.5].map(Math.fround));
    expect(Array.from(packed.slice(4))).toEqual(new Array(MAX_RIPPLES * 4 - 4).fill(0));
  });
});
