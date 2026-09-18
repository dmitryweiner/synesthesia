// Scout — fractality-guided proposals (PLAN.md, decision 7). While the user
// listens to a settled point, the scout renders that point and k 👍 + k 👎
// candidates offline (injected `render`, the real audio graph in the app),
// scores them with `analyze` (src/analysis/fractal.ts) and, on a press,
// hands out the best candidate for that direction. A candidate much quieter
// than the current point is penalized — the search shouldn't sink into
// silence one step at a time. Jobs are keyed by Explorer.version: any
// committed change makes the prepared candidates stale.
import type { SoundAnalysis } from '../analysis/fractal';
import type { AppState } from '../state/schema';
import type { Genome } from './codec';
import { decodeGenome } from './codec';
import type { Explorer } from './explorer';

export type ScoutRender = (state: AppState) => Promise<Float32Array>;
export type ScoutAnalyze = (samples: Float32Array) => SoundAnalysis;
export type ScoutKind = 'like' | 'dislike';

export interface ScoutOptions {
  render: ScoutRender;
  analyze: ScoutAnalyze;
  /** Candidates per direction. */
  k?: number;
  /** Called after the parent and after each candidate is scored. */
  onProgress?: () => void;
}

export interface ScoutCandidate {
  kind: ScoutKind;
  genome: Genome;
  analysis: SoundAnalysis | null;
  adjusted: number;
}

export interface ScoutPick {
  genome: Genome;
  analysis: SoundAnalysis;
  /** How many scored candidates it was chosen from. */
  of: number;
}

const FREE_DROP_DB = 6;    // quieter by up to this much: no penalty
const PENALTY_PER_DB = 1 / 24;

/** Fractal score minus a penalty for being much quieter than the parent; silence ranks last. */
export function adjustedScore(a: SoundAnalysis, parent: SoundAnalysis | null): number {
  if (a.silent) return -1;
  if (!parent || parent.silent) return a.score;
  const drop = parent.loudness - a.loudness;
  return a.score - Math.max(0, drop - FREE_DROP_DB) * PENALTY_PER_DB;
}

export class Scout {
  parent: SoundAnalysis | null = null;
  busy = false;
  disabled = false;
  lastError: unknown = null;

  private readonly render: ScoutRender;
  private readonly analyze: ScoutAnalyze;
  private readonly k: number;
  private readonly onProgress: () => void;
  private job = 0;
  private version = -1;
  private list: ScoutCandidate[] = [];

  constructor(opts: ScoutOptions) {
    this.render = opts.render;
    this.analyze = opts.analyze;
    this.k = opts.k ?? 3;
    this.onProgress = opts.onProgress ?? (() => {});
  }

  /** Starts scouting the explorer's current point (cancels any previous job). */
  prepare(explorer: Explorer, masterGain = 0.75): void {
    if (this.disabled) return;
    const job = ++this.job;
    this.version = explorer.version;
    this.parent = null;
    this.list = [];
    // Interleave directions so both get candidates early if the user is quick.
    for (let i = 0; i < this.k; i++) {
      this.list.push({ kind: 'like', genome: explorer.proposeLike(), analysis: null, adjusted: -Infinity });
      this.list.push({ kind: 'dislike', genome: explorer.proposeDislike(), analysis: null, adjusted: -Infinity });
    }
    this.busy = true;
    void this.run(job, explorer.current, masterGain);
  }

  /** Stops the current job; prepared candidates are dropped. */
  cancel(): void {
    this.job++;
    this.busy = false;
    this.list = [];
    this.parent = null;
  }

  private stateOf(g: Genome, masterGain: number): AppState {
    const s = decodeGenome(g);
    s.audio.masterGain = masterGain;
    return s;
  }

  private async run(job: number, current: Genome, masterGain: number): Promise<void> {
    try {
      const parentSamples = await this.render(this.stateOf(current, masterGain));
      if (job !== this.job) return;
      this.parent = this.analyze(parentSamples);
      this.onProgress();
      for (const c of this.list) {
        const samples = await this.render(this.stateOf(c.genome, masterGain));
        if (job !== this.job) return;
        c.analysis = this.analyze(samples);
        c.adjusted = adjustedScore(c.analysis, this.parent);
        this.onProgress();
      }
    } catch (err) {
      if (job !== this.job) return;
      this.disabled = true;
      this.lastError = err;
      this.list = [];
    }
    if (job === this.job) this.busy = false;
  }

  /** Scored candidates for a direction (in preparation order). */
  candidates(kind: ScoutKind): ScoutCandidate[] {
    return this.list.filter((c) => c.kind === kind && c.analysis !== null);
  }

  ready(kind: ScoutKind): number {
    return this.candidates(kind).length;
  }

  /** Best scored candidate for `kind`, or null if none is ready / the explorer moved on. */
  take(explorer: Explorer, kind: ScoutKind): ScoutPick | null {
    if (this.disabled || explorer.version !== this.version) return null;
    const ready = this.candidates(kind);
    let best: ScoutCandidate | null = null;
    for (const c of ready) if (!best || c.adjusted > best.adjusted) best = c;
    if (!best || !best.analysis) return null;
    return { genome: best.genome, analysis: best.analysis, of: ready.length };
  }
}
