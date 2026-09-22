import { fieldGridSize, gridSize } from '../src/sim/grid';

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

describe('fieldGridSize', () => {
  it('halves both sides, so the noise passes cost a quarter of the cells', () => {
    expect(fieldGridSize({ width: 1024, height: 576 })).toEqual({ width: 512, height: 288 });
    expect(fieldGridSize({ width: 256, height: 144 })).toEqual({ width: 128, height: 72 });
  });

  it('keeps the aspect, so the noise stays isotropic on screen', () => {
    const g = gridSize(1024, 390, 719);
    const f = fieldGridSize(g);
    expect(f.width / f.height).toBeCloseTo(g.width / g.height, 2);
  });

  it('never goes below the 32-px floor a tiny grid already sits on', () => {
    expect(fieldGridSize({ width: 1024, height: 32 }).height).toBe(32);
    expect(fieldGridSize({ width: 64, height: 64 })).toEqual({ width: 32, height: 32 });
  });
});
