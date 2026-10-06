// The scout's Web Worker pool (PLAN-CORE.md C4, phase 4). The core's
// session decides WHAT to render and WHEN (a `startScout` effect); this only
// runs a job's units — the parent and each candidate — one per worker, and
// puts the result together for WebSession.scoutFinished(). No
// SharedArrayBuffer, so no COOP/COEP: each worker is its own
// single-threaded wasm instance.
import {
  isScoutWorkerOut, type ScoutAnalysis, type ScoutJob, type ScoutKind, type ScoutResultJson, type ScoutWorkerIn,
} from './protocol';

/** What the pool needs of a Worker (a test passes a fake). */
export interface WorkerLike {
  postMessage(msg: ScoutWorkerIn): void;
  onmessage: ((e: MessageEvent) => void) | null;
  terminate(): void;
}

export interface PoolOptions {
  /** How many workers; default every core but two (the sound keeps one,
   *  the page another — the console's xrun lesson), at least one. */
  size?: number;
  makeWorker?: () => WorkerLike;
  /** The compiled core, handed to each worker once. */
  module: () => Promise<WebAssembly.Module>;
  now?: () => number;
}

interface Unit { id: number; kind: ScoutKind; genome: number[] }

interface Running {
  job: ScoutJob;
  started: number;
  queue: Unit[];
  open: Set<number>;
  parent: ScoutAnalysis | null;
  candidates: ScoutResultJson['candidates'];
  resolve: (r: ScoutResultJson) => void;
}

/** The version of a cancelled job's result — never the explorer's. */
export const CANCELLED = -1;

const READY_TIMEOUT_MS = 3000;

export function defaultPoolSize(cores = typeof navigator !== 'undefined' ? navigator.hardwareConcurrency : 4): number {
  return Math.max(1, (cores || 4) - 2);
}

export class ScoutPool {
  private readonly size: number;
  private readonly makeWorker: () => WorkerLike;
  private readonly now: () => number;
  private readonly module: () => Promise<WebAssembly.Module>;
  private workers: WorkerLike[] = [];
  private idle: WorkerLike[] = [];
  private busy = new Map<WorkerLike, number>();
  private running: Running | null = null;
  /** Units out with a worker, by id — what each was, when it comes back. */
  private readonly units = new Map<number, Unit>();
  private nextId = 1;

  constructor(opts: PoolOptions) {
    this.size = opts.size ?? defaultPoolSize();
    this.module = opts.module;
    this.now = opts.now ?? (() => performance.now() / 1000);
    this.makeWorker = opts.makeWorker
      ?? (() => new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' }));
  }

  get workerCount(): number {
    return this.workers.length;
  }

  private starting: Promise<void> | null = null;

  /** Workers come up one at a time, each after the last said it is ready:
   *  six instantiating at once cost the sound a 51 ms gap on an Android
   *  phone (PLAN-CORE.md phase 4). The first can start work meanwhile. */
  private start(): Promise<void> {
    this.starting ??= (async () => {
      const module = await this.module();
      for (let i = 0; i < this.size; i++) {
        const w = this.makeWorker();
        const ready = new Promise<void>((resolve) => {
          const go = (): void => {
            w.onmessage = (ev: MessageEvent) => this.onResult(w, ev.data);
            resolve();
          };
          w.onmessage = (e: MessageEvent) => { if (isScoutWorkerOut(e.data) && e.data.type === 'ready') go(); };
          setTimeout(go, READY_TIMEOUT_MS); // never wait forever on one
        });
        w.postMessage({ type: 'init', module });
        await ready;
        this.workers.push(w);
        this.idle.push(w);
        this.dispatch();
      }
    })();
    return this.starting;
  }

  /** Runs a job; resolves with its result (or, after cancel(), at once with
   *  version CANCELLED). */
  async run(job: ScoutJob): Promise<ScoutResultJson> {
    this.cancel();
    void this.start();
    const units: Unit[] = [{ id: this.nextId++, kind: 'parent', genome: job.parent }];
    // interleaved, so both directions get candidates early
    for (let i = 0; i < Math.max(job.likes.length, job.dislikes.length); i++) {
      if (job.likes[i]) units.push({ id: this.nextId++, kind: 'like', genome: job.likes[i] });
      if (job.dislikes[i]) units.push({ id: this.nextId++, kind: 'dislike', genome: job.dislikes[i] });
    }
    return new Promise<ScoutResultJson>((resolve) => {
      this.running = {
        job, started: this.now(), queue: units, open: new Set(units.map((u) => u.id)),
        parent: null, candidates: [], resolve,
      };
      this.dispatch();
    });
  }

  /** Drops what is still queued and settles the job as cancelled (version
   *  −1: the session drops it whatever its own version is, and may scout
   *  again). Units a worker is already rendering finish and are ignored. */
  cancel(): void {
    const r = this.running;
    if (!r) return;
    this.running = null;
    r.resolve({ ...this.result(r), version: CANCELLED });
  }

  terminate(): void {
    this.cancel();
    for (const w of this.workers) w.terminate();
    this.workers = [];
    this.idle = [];
    this.busy.clear();
    this.starting = null;
  }

  private result(r: Running): ScoutResultJson {
    return { version: r.job.version, seconds: this.now() - r.started, parent: r.parent, candidates: r.candidates };
  }

  private dispatch(): void {
    const r = this.running;
    if (!r) return;
    while (this.idle.length > 0 && r.queue.length > 0) {
      const w = this.idle.pop();
      const u = r.queue.shift();
      if (!w || !u) break;
      this.busy.set(w, u.id);
      w.postMessage({ type: 'score', id: u.id, genome: u.genome, settings: r.job.settings });
      this.units.set(u.id, u);
    }
  }

  private onResult(w: WorkerLike, data: unknown): void {
    if (!isScoutWorkerOut(data) || data.type === 'ready') return;
    this.busy.delete(w);
    this.idle.push(w);
    const unit = this.units.get(data.id);
    this.units.delete(data.id);
    const r = this.running;
    if (r && unit && r.open.has(data.id)) {
      r.open.delete(data.id);
      if (data.type === 'scored') {
        if (unit.kind === 'parent') r.parent = data.analysis;
        else r.candidates.push({ kind: unit.kind, genome: unit.genome, analysis: data.analysis });
      }
      if (r.open.size === 0) {
        this.running = null;
        r.resolve(this.result(r));
      }
    }
    this.dispatch();
  }
}
