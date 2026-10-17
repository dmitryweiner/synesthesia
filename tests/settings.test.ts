// The ⚙ Settings page's presentation (src/ui/settingsModel.ts): slider
// scales and readouts. The page's model and its rules — which controls exist,
// the filter rows, the formula cap, the routes, and the guarantee that every
// value survives the genome — are the core's now (PLAN-CORE.md C13):
// synesthesia-core syn-core/tests/settings_page.rs.
import { LOG_STEPS, formatValue, fromSliderPos, isLogScale, rangeAttrs, toSliderPos } from '../src/ui/settingsModel';
import type { Scale } from '../src/ui/settingsModel';

describe('slider scale', () => {
  const lin: Scale = { min: 0, max: 10, step: 0.01 };
  const hz: Scale = { min: 20, max: 2000, step: 1, exp: true };
  const lfo: Scale = { min: 0.003, max: 2, exp: true };

  it('a linear slider is the value itself', () => {
    expect(isLogScale(lin)).toBe(false);
    expect(rangeAttrs(lin)).toEqual({ min: 0, max: 10, step: 0.01 });
    expect(toSliderPos(lin, 3.3)).toBe(3.3);
    expect(fromSliderPos(lin, 3.3)).toBe(3.3);
    expect(fromSliderPos(lin, 12)).toBe(10);
  });

  it('a frequency-like slider moves in octaves: the ends are min/max, the middle is the geometric mean', () => {
    expect(isLogScale(hz)).toBe(true);
    expect(rangeAttrs(hz)).toEqual({ min: 0, max: LOG_STEPS, step: 1 });
    expect(toSliderPos(hz, 20)).toBe(0);
    expect(toSliderPos(hz, 2000)).toBe(LOG_STEPS);
    expect(fromSliderPos(hz, LOG_STEPS / 2)).toBe(200);
    expect(fromSliderPos(lfo, 0)).toBeCloseTo(0.003, 12);
    expect(fromSliderPos(lfo, LOG_STEPS)).toBeCloseTo(2, 12);
    // out-of-range positions and values clamp
    expect(fromSliderPos(hz, -5)).toBe(20);
    expect(toSliderPos(hz, 1e6)).toBe(LOG_STEPS);
  });

  it('whole-step exp values come out whole (the genome decodes step ≥ 1 genes rounded)', () => {
    for (let pos = 0; pos <= LOG_STEPS; pos += 37) expect(Number.isInteger(fromSliderPos(hz, pos))).toBe(true);
  });

  it('pos → value → pos is stable, so a synced slider does not creep', () => {
    for (let pos = 0; pos <= LOG_STEPS; pos += 37) expect(toSliderPos(lfo, fromSliderPos(lfo, pos))).toBe(pos);
  });

  it('exp over a range that touches zero falls back to linear', () => {
    expect(isLogScale({ min: 0, max: 1, exp: true })).toBe(false);
  });
});

describe('formatValue', () => {
  it('shows as many decimals as the step has', () => {
    expect(formatValue(0.037, 0.0005)).toBe('0.0370');
    expect(formatValue(110, 1)).toBe('110');
    expect(formatValue(2.6667, 0.0001)).toBe('2.6667');
    expect(formatValue(-12, 0.5)).toBe('-12.0');
  });

  it('without a step: three significant digits below 1, fewer decimals above', () => {
    expect(formatValue(0.05)).toBe('0.05');
    expect(formatValue(0.00312)).toBe('0.00312');
    expect(formatValue(1.5)).toBe('1.50');
    expect(formatValue(12.34)).toBe('12.3');
    expect(formatValue(440.2)).toBe('440');
  });
});


describe('the layers on the page', () => {
  it('reading a layer leaves a point without layers as it was; writing one makes the slot', async () => {
    const { emptyLayer, layerOf, soundName, writableLayer } = await import('../src/ui/settingsModel');
    const point: Pick<import('../src/state/types').AppState, 'seq'> = {};
    expect(layerOf(point, 2)).toEqual(emptyLayer());
    expect('seq' in point).toBe(false);
    writableLayer(point, 2).on = true;
    expect(point.seq?.layers.map((l) => l.on)).toEqual([false, false, true]);
    expect(point.seq?.cps).toBe(0.5);
    expect(soundName('owl:12')).toBe('owl');
    expect(soundName('great-tit')).toBe('great-tit');
  });
});

describe('the binaural section on the page', () => {
  it('reading leaves a point without space as it was; writing makes the core\'s neutral section', async () => {
    const { binOf, binauralPage, writableBin } = await import('../src/ui/settingsModel');
    const { sanitize } = await import('../src/core/point');
    const page = binauralPage();
    expect([page.width.k, page.beat.k]).toEqual(['width', 'beat']);
    const point: Pick<import('../src/state/types').AppState, 'bin'> = {};
    expect(binOf(point)).toEqual({ on: false, beat: page.beat.min, width: 0 });
    expect('bin' in point).toBe(false);
    writableBin(point).width = 0.6;
    expect(point.bin).toEqual({ on: false, beat: page.beat.min, width: 0.6 });
    // the core keeps what the page wrote, and drops a neutral section
    const { defaultPoint } = await import('./points');
    const wide = sanitize({ ...defaultPoint(), bin: { on: true, beat: 6, width: 0.6 } });
    expect(wide?.bin).toEqual({ on: true, beat: 6, width: 0.6 });
    expect(sanitize({ ...defaultPoint(), bin: binOf({}) })?.bin).toBeUndefined();
  });
});
