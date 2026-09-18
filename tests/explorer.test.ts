import { Explorer } from '../src/genome/explorer';
import { diffDims, enabledFormulaCount, isValidGenome } from '../src/genome/evolve';
import { GENES } from '../src/genome/genes';
import { encodeGenome } from '../src/genome/codec';
import { defaultAppState } from '../src/state/schema';
import { mulberry32 } from '../src/dsp/rng';
import { MAX_ENABLED_FORMULAS } from '../src/schema/audio';

function start() {
  const s = defaultAppState();
  s.audio.formulas.fm.enabled = true;
  s.audio.formulas.ocean.enabled = true;
  s.visual.cards.flow.on = true;
  s.visual.cards.fieldVariation.on = true;
  return encodeGenome(s);
}

function contDiff(a: number[], b: number[]): number[] {
  return diffDims(a, b).filter((i) => GENES[i].kind === 'cont');
}

describe('Explorer', () => {
  it('starts at the given genome with empty history', () => {
    const ex = new Explorer(start(), { rng: mulberry32(1) });
    expect(ex.current).toEqual(start());
    expect(ex.canUndo).toBe(false);
    expect(ex.undoDepth).toBe(0);
    expect(ex.lastAction).toBe('load');
  });

  it('like: proposes a new valid genome, anchors the liked point, shrinks sigma', () => {
    const ex = new Explorer(start(), { rng: mulberry32(2) });
    const s0 = ex.sigma;
    const liked = ex.current;
    const next = ex.like();
    expect(next).toBe(ex.current);
    expect(next).not.toEqual(liked);
    expect(isValidGenome(next)).toBe(true);
    expect(ex.anchor).toEqual(liked);
    expect(ex.sigma).toBeLessThan(s0);
    expect(ex.lastAction).toBe('like');
    expect(ex.undoDepth).toBe(1);
  });

  it('like twice: the second step continues the first (momentum): most first-step dims move the same way', () => {
    let agree = 0;
    let total = 0;
    for (let seed = 0; seed < 30; seed++) {
      const ex = new Explorer(start(), { rng: mulberry32(100 + seed) });
      const p0 = ex.current;
      const p1 = ex.like();
      const p2 = ex.like();
      for (const i of contDiff(p0, p1)) {
        const d1 = p1[i] - p0[i];
        const d2 = p2[i] - p1[i];
        if (d2 === 0) continue;
        total++;
        if (Math.sign(d1) === Math.sign(d2)) agree++;
      }
    }
    expect(total).toBeGreaterThan(20);
    expect(agree / total).toBeGreaterThan(0.75);
  });

  it('dislike: returns near the anchor, avoids the rejected dims, grows sigma', () => {
    for (let seed = 0; seed < 20; seed++) {
      const ex = new Explorer(start(), { rng: mulberry32(200 + seed) });
      const anchor = ex.current;
      const rejected = ex.like(); // anchor = start, current = proposal
      expect(ex.anchor).toEqual(anchor);
      const rejectedDims = new Set(contDiff(anchor, rejected));
      const s0 = ex.sigma;
      const next = ex.dislike();
      expect(ex.sigma).toBeGreaterThan(s0);
      expect(ex.anchor).toEqual(anchor); // anchor unchanged
      for (const i of contDiff(anchor, next)) expect(rejectedDims.has(i), GENES[i].id).toBe(false);
      expect(ex.lastAction).toBe('dislike');
    }
  });

  it('sigma stays within [sigmaMin, sigmaMax]', () => {
    const ex = new Explorer(start(), { rng: mulberry32(3), sigmaMin: 0.05, sigmaMax: 0.3 });
    for (let i = 0; i < 30; i++) ex.like();
    expect(ex.sigma).toBeCloseTo(0.05, 9);
    for (let i = 0; i < 30; i++) ex.dislike();
    expect(ex.sigma).toBeCloseTo(0.3, 9);
  });

  it('undo reverts the last changes, depth 5, then null', () => {
    const ex = new Explorer(start(), { rng: mulberry32(4), historyDepth: 5 });
    const points = [ex.current];
    for (let i = 0; i < 7; i++) {
      points.push(i % 2 ? ex.dislike() : ex.like());
    }
    expect(ex.undoDepth).toBe(5);
    for (let i = 0; i < 5; i++) {
      const back = ex.undo();
      expect(back).toEqual(points[points.length - 2 - i]);
      expect(ex.current).toEqual(back);
      expect(ex.lastAction).toBe('undo');
    }
    expect(ex.canUndo).toBe(false);
    expect(ex.undo()).toBeNull();
    // after undo the anchor is the restored point
    expect(ex.anchor).toEqual(ex.current);
  });

  it('surprise: jumps near the given genome and is undoable; load resets history', () => {
    const ex = new Explorer(start(), { rng: mulberry32(5) });
    ex.like();
    const target = start();
    target[0] = 1 - target[0];
    const got = ex.surprise(target);
    expect(isValidGenome(got)).toBe(true);
    expect(ex.lastAction).toBe('surprise');
    expect(ex.undoDepth).toBe(2);
    ex.load(start());
    expect(ex.current).toEqual(start());
    expect(ex.undoDepth).toBe(0);
    expect(ex.lastAction).toBe('load');
  });

  it('every produced genome keeps 1..MAX formulas enabled', () => {
    const ex = new Explorer(start(), { rng: mulberry32(6) });
    for (let i = 0; i < 200; i++) {
      const g = i % 3 === 0 ? ex.dislike() : ex.like();
      const n = enabledFormulaCount(g);
      expect(n).toBeGreaterThanOrEqual(1);
      expect(n).toBeLessThanOrEqual(MAX_ENABLED_FORMULAS);
    }
  });
});

describe('Explorer: propose-then-commit (used by the scout)', () => {
  it('proposeLike/proposeDislike do not change explorer state', () => {
    const ex = new Explorer(start(), { rng: mulberry32(10) });
    ex.like();
    const snapshot = { current: [...ex.current], anchor: [...ex.anchor], sigma: ex.sigma, depth: ex.undoDepth, version: ex.version };
    ex.proposeLike();
    ex.proposeDislike();
    expect(ex.current).toEqual(snapshot.current);
    expect(ex.anchor).toEqual(snapshot.anchor);
    expect(ex.sigma).toBe(snapshot.sigma);
    expect(ex.undoDepth).toBe(snapshot.depth);
    expect(ex.version).toBe(snapshot.version);
  });

  it('like(p) commits exactly p with the same bookkeeping as like()', () => {
    const a = new Explorer(start(), { rng: mulberry32(11) });
    a.like();
    const p = a.proposeLike();
    const liked = a.current;
    const s0 = a.sigma;
    const got = a.like(p);
    expect(got).toEqual(p);
    expect(a.current).toEqual(p);
    expect(a.anchor).toEqual(liked);
    expect(a.sigma).toBeLessThan(s0);
    expect(a.lastAction).toBe('like');
  });

  it('dislike(p) commits exactly p; proposals avoid the rejected dims', () => {
    for (let seed = 0; seed < 10; seed++) {
      const ex = new Explorer(start(), { rng: mulberry32(300 + seed) });
      const anchor = ex.current;
      const rejected = ex.like();
      const rejectedDims = new Set(contDiff(anchor, rejected));
      const p = ex.proposeDislike();
      for (const i of contDiff(anchor, p)) expect(rejectedDims.has(i)).toBe(false);
      expect(ex.dislike(p)).toEqual(p);
      expect(ex.anchor).toEqual(anchor);
    }
  });

  it('version bumps on every state change', () => {
    const ex = new Explorer(start(), { rng: mulberry32(12) });
    const seen = new Set([ex.version]);
    ex.like(); seen.add(ex.version);
    ex.dislike(); seen.add(ex.version);
    ex.surprise(start()); seen.add(ex.version);
    ex.undo(); seen.add(ex.version);
    ex.load(start()); seen.add(ex.version);
    expect(seen.size).toBe(6);
  });
});
