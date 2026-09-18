// Directed search driven by like/dislike (see PLAN.md, decision 1):
//   like     — anchor here, continue along the step that led here with a
//              smaller spread (momentum + small sparse noise);
//   dislike  — return to the anchor, step elsewhere (avoiding the rejected
//              dimensions) with a larger spread;
//   surprise — jump near a given genome (a random preset), reset the search;
//   undo     — pop the last change (bounded history).
// Pure bookkeeping over genome/evolve.ts; the rng is injected.
import type { Rng } from '../dsp/rng';
import { GENES } from './genes';
import type { Genome } from './codec';
import { diffDims, mutate, repair } from './evolve';

export type ExplorerAction = 'load' | 'like' | 'dislike' | 'surprise' | 'undo';

export interface ExplorerOptions {
  rng?: Rng;
  sigma0?: number;
  sigmaMin?: number;
  sigmaMax?: number;
  /** Continuous genes kicked per proposal. */
  k?: number;
  historyDepth?: number;
}

const SIGMA_SHRINK = 0.8;
const SIGMA_GROW = 1.35;
const MOMENTUM_WEIGHT = 0.6;
const MOMENTUM_CAP = 0.25;
const LIKE_STRUCTURAL = 0.12;
const DISLIKE_STRUCTURAL = 0.3;
const SURPRISE_SIGMA = 0.08;

export class Explorer {
  current: Genome;
  anchor: Genome;
  sigma: number;
  lastAction: ExplorerAction = 'load';

  private momentum: Genome | null = null;
  private history: Genome[] = [];
  private readonly rng: Rng;
  private readonly sigma0: number;
  private readonly sigmaMin: number;
  private readonly sigmaMax: number;
  private readonly k: number;
  private readonly historyDepth: number;

  constructor(initial: Genome, opts: ExplorerOptions = {}) {
    this.rng = opts.rng ?? Math.random;
    this.sigma0 = opts.sigma0 ?? 0.12;
    this.sigmaMin = opts.sigmaMin ?? 0.04;
    this.sigmaMax = opts.sigmaMax ?? 0.35;
    this.k = opts.k ?? 6;
    this.historyDepth = opts.historyDepth ?? 5;
    this.current = [...initial];
    this.anchor = [...initial];
    this.sigma = this.sigma0;
  }

  get canUndo(): boolean {
    return this.history.length > 0;
  }

  get undoDepth(): number {
    return this.history.length;
  }

  private push(): void {
    this.history.push([...this.current]);
    if (this.history.length > this.historyDepth) this.history.shift();
  }

  /** "Keep going this way": anchor here, continue along the last step. */
  like(): Genome {
    const prevAnchor = this.anchor;
    this.anchor = [...this.current];
    const delta = new Array<number>(this.current.length).fill(0);
    let any = false;
    for (const i of diffDims(prevAnchor, this.current)) {
      if (GENES[i].kind !== 'cont') continue;
      delta[i] = Math.max(-MOMENTUM_CAP, Math.min(MOMENTUM_CAP, this.current[i] - prevAnchor[i]));
      any = true;
    }
    this.momentum = any ? delta : null;
    this.sigma = Math.max(this.sigmaMin, this.sigma * SIGMA_SHRINK);
    this.push();
    const next = mutate(this.current, this.rng, {
      sigma: this.sigma, k: this.k, structuralProb: LIKE_STRUCTURAL,
      momentum: this.momentum, momentumWeight: MOMENTUM_WEIGHT,
    });
    this.current = repair(next, this.rng);
    this.lastAction = 'like';
    return this.current;
  }

  /** "Go back and try elsewhere": from the anchor, avoiding the rejected dims. */
  dislike(): Genome {
    const rejected = new Set(diffDims(this.anchor, this.current).filter((i) => GENES[i].kind === 'cont'));
    this.momentum = null;
    this.sigma = Math.min(this.sigmaMax, this.sigma * SIGMA_GROW);
    this.push();
    const next = mutate(this.anchor, this.rng, {
      sigma: this.sigma, k: this.k, structuralProb: DISLIKE_STRUCTURAL, avoid: rejected,
    });
    this.current = repair(next, this.rng);
    this.lastAction = 'dislike';
    return this.current;
  }

  /** Jump near `target` (e.g. a random preset) and restart the search there. */
  surprise(target: Genome): Genome {
    this.push();
    const next = mutate(target, this.rng, { sigma: SURPRISE_SIGMA, k: 4, structuralProb: 0 });
    this.current = repair(next, this.rng);
    this.anchor = [...this.current];
    this.momentum = null;
    this.sigma = this.sigma0;
    this.lastAction = 'surprise';
    return this.current;
  }

  /** Load a point (preset / share link): fresh start, history cleared. */
  load(g: Genome): void {
    this.current = [...g];
    this.anchor = [...g];
    this.momentum = null;
    this.sigma = this.sigma0;
    this.history = [];
    this.lastAction = 'load';
  }

  /** Reverts the last change; null when there's nothing to undo. */
  undo(): Genome | null {
    const prev = this.history.pop();
    if (!prev) return null;
    this.current = prev;
    this.anchor = [...prev];
    this.momentum = null;
    this.lastAction = 'undo';
    return this.current;
  }
}
