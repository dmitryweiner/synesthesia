// B8 (PLAN.md #22): numbers for the picture — is there a pattern, how
// intricate is it, is it still moving? Catches "the pattern died" and
// "nothing changes" without looking at screenshots.
import { pictureMetrics } from '../src/analysis/picture';

const W = 64;
const H = 48;

function field(f: (x: number, y: number) => number): Float32Array {
  return Float32Array.from({ length: W * H }, (_, i) => f(i % W, Math.floor(i / W)));
}

describe('pictureMetrics', () => {
  it('an empty field: no coverage, no edges', () => {
    const m = pictureMetrics(field(() => 0), W, H);
    expect(m.coverage).toBe(0);
    expect(m.edges).toBe(0);
    expect(m.alive).toBe(false);
  });

  it('coverage is the share of cells holding pattern', () => {
    const m = pictureMetrics(field((x) => (x < W / 2 ? 0.3 : 0)), W, H);
    expect(m.coverage).toBeCloseTo(0.5, 2);
    expect(m.alive).toBe(true);
  });

  it('fine stripes have far more edges than one big blob', () => {
    const stripes = pictureMetrics(field((x) => (Math.floor(x / 2) % 2 ? 0.3 : 0)), W, H);
    const blob = pictureMetrics(field((x) => (x < W / 2 ? 0.3 : 0)), W, H);
    expect(stripes.edges).toBeGreaterThan(5 * blob.edges);
  });

  it('change: zero for the same frame, positive once the pattern moves', () => {
    const a = field((x) => (Math.floor(x / 4) % 2 ? 0.3 : 0));
    const b = field((x) => (Math.floor((x + 1) / 4) % 2 ? 0.3 : 0));
    expect(pictureMetrics(a, W, H, a).change).toBe(0);
    expect(pictureMetrics(b, W, H, a).change).toBeGreaterThan(0.05);
    expect(Number.isNaN(pictureMetrics(a, W, H).change)).toBe(true);
  });
});
