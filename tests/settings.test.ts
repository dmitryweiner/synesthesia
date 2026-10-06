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

