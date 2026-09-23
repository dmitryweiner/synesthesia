import { canvasUv, strokePoints, TOUCH_RADIUS, TOUCH_AMOUNT } from '../src/ui/touch';

const rect = { left: 100, top: 50, width: 800, height: 400 };

describe('canvasUv', () => {
  it('flips Y: the canvas is Y-up, a pointer is Y-down', () => {
    expect(canvasUv(rect, 100, 50)).toEqual([0, 1]);      // top-left of the element
    expect(canvasUv(rect, 900, 450)).toEqual([1, 0]);     // bottom-right
    expect(canvasUv(rect, 500, 250)).toEqual([0.5, 0.5]); // centre
  });

  it('clamps: a pointer captured outside the canvas still paints at its edge', () => {
    expect(canvasUv(rect, -400, -400)).toEqual([0, 1]);
    expect(canvasUv(rect, 5000, 5000)).toEqual([1, 0]);
  });

  it('survives a zero-sized canvas instead of returning NaN', () => {
    const [u, v] = canvasUv({ left: 0, top: 0, width: 0, height: 0 }, 10, 10);
    expect(Number.isFinite(u)).toBe(true);
    expect(Number.isFinite(v)).toBe(true);
  });
});

// A drag is sampled once per frame. At 10 fps a finger crossing the screen
// moves a third of it between two frames, so stamping only where the pointer
// is would leave a dotted trail instead of a stroke.
describe('strokePoints', () => {
  it('a move shorter than the spacing is just the destination', () => {
    expect(strokePoints([0.5, 0.5], [0.51, 0.5], 0.05, 1, 8)).toEqual([[0.51, 0.5]]);
  });

  it('fills a long move evenly and always ends exactly on the destination', () => {
    const pts = strokePoints([0, 0.5], [0.4, 0.5], 0.1, 1, 8);
    expect(pts).toHaveLength(4);
    expect(pts[pts.length - 1]).toEqual([0.4, 0.5]);
    for (let i = 0; i < pts.length; i++) expect(pts[i][0]).toBeCloseTo(0.1 * (i + 1), 6);
  });

  it('never stamps the point it started from (two frames would double it)', () => {
    const pts = strokePoints([0.2, 0.2], [0.9, 0.9], 0.05, 1, 32);
    expect(pts.some((p) => p[0] === 0.2 && p[1] === 0.2)).toBe(false);
  });

  it('caps the number of stamps — one frame must not queue a hundred passes', () => {
    const pts = strokePoints([0, 0], [1, 1], 0.001, 1, 8);
    expect(pts).toHaveLength(8);
    expect(pts[7]).toEqual([1, 1]);
  });

  it('measures distance on screen, not in UV: a wide canvas needs more stamps across', () => {
    const across = strokePoints([0, 0.5], [0.4, 0.5], 0.1, 3, 32); // 3:1 canvas
    const down = strokePoints([0.5, 0], [0.5, 0.4], 0.1, 3, 32);
    expect(across.length).toBeGreaterThan(down.length);
  });

  it('a pointer that has not moved still stamps once (a press is a press)', () => {
    expect(strokePoints([0.3, 0.7], [0.3, 0.7], 0.05, 1, 8)).toEqual([[0.3, 0.7]]);
  });
});

describe('touch strength', () => {
  it('is fixed, not a gene: a point with no onsetToSeed must still react', () => {
    expect(TOUCH_AMOUNT).toBeGreaterThan(0.5);
    expect(TOUCH_RADIUS).toBeGreaterThan(0.01);
    expect(TOUCH_RADIUS).toBeLessThan(0.1);
  });
});
