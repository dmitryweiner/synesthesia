import { gridSize } from '../src/sim/grid';

describe('gridSize', () => {
  it('long side = res, short side follows the canvas aspect', () => {
    expect(gridSize(1024, 1600, 800)).toEqual({ width: 1024, height: 512 });
    expect(gridSize(1024, 800, 1600)).toEqual({ width: 512, height: 1024 });
    expect(gridSize(512, 1000, 1000)).toEqual({ width: 512, height: 512 });
  });

  it('keeps texels square (grid aspect ≈ canvas aspect)', () => {
    const g = gridSize(1024, 390, 719);
    expect(g.height).toBe(1024);
    expect(g.width / g.height).toBeCloseTo(390 / 719, 2);
  });

  it('never collapses: short side ≥ 32 even for extreme aspects; degenerate canvas → square', () => {
    expect(gridSize(1024, 5000, 10).height).toBe(32);
    expect(gridSize(256, 0, 0)).toEqual({ width: 256, height: 256 });
  });
});
