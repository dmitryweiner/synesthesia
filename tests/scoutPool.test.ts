import { CANCELLED, ScoutPool, defaultPoolSize, type WorkerLike } from '../src/scout/pool';
import type { ScoutAnalysis, ScoutJob, ScoutWorkerIn } from '../src/scout/protocol';

class FakeWorker implements WorkerLike {
  onmessage: ((e: MessageEvent) => void) | null = null;
  inbox: ScoutWorkerIn[] = [];
  terminated = false;
  postMessage(m: ScoutWorkerIn): void {
    this.inbox.push(m);
    if (m.type === 'init') queueMicrotask(() => this.onmessage?.(new MessageEvent('message', { data: { type: 'ready' } })));
  }
  terminate(): void { this.terminated = true; }
  /** Answers the oldest unanswered unit. */
  answer(score: number): number {
    const u = this.inbox.find((m) => m.type === 'score' && !this.answered.has(m.id));
    if (!u || u.type !== 'score') throw new Error('nothing to answer');
    this.answered.add(u.id);
    const analysis: ScoutAnalysis = { silent: false, loudness: -20, envBeta: 1, centroidBeta: 1, envHiguchi: 1.5, boxDim: 1.5, score };
    this.onmessage?.(new MessageEvent('message', { data: { type: 'scored', id: u.id, analysis } }));
    return u.id;
  }
  answered = new Set<number>();
  get pending(): number { return this.inbox.filter((m) => m.type === 'score' && !this.answered.has(m.id)).length; }
}

// the smallest valid module: the magic number and the version
const EMPTY_MODULE = new WebAssembly.Module(new Uint8Array([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00]));

const job = (version: number): ScoutJob => ({
  version,
  parent: [0],
  likes: [[1], [2], [3]],
  dislikes: [[-1], [-2], [-3]],
  settings: { seconds: 24, sampleRate: 8000, masterGain: 0.75, seed: 1 },
});

function pool(size: number): { p: ScoutPool; workers: FakeWorker[]; t: { now: number } } {
  const workers: FakeWorker[] = [];
  const t = { now: 0 };
  const p = new ScoutPool({
    size,
    module: async () => EMPTY_MODULE,
    makeWorker: () => { const w = new FakeWorker(); workers.push(w); return w; },
    now: () => t.now,
  });
  return { p, workers, t };
}

const flush = async (): Promise<void> => { for (let i = 0; i < 20; i++) await new Promise((r) => setTimeout(r, 0)); };

describe('the scout pool', () => {
  it('leaves two cores to the sound and the page', () => {
    expect(defaultPoolSize(8)).toBe(6);
    expect(defaultPoolSize(2)).toBe(1);
    expect(defaultPoolSize(1)).toBe(1);
  });

  it('runs the parent and every candidate, one unit per worker, and assembles the result', async () => {
    const { p, workers, t } = pool(3);
    const done = p.run(job(7));
    await flush();
    expect(workers).toHaveLength(3);
    expect(workers.every((w) => w.inbox[0].type === 'init')).toBe(true);
    expect(workers.map((w) => w.pending)).toEqual([1, 1, 1]); // 7 units, 3 at a time
    t.now = 2.5;
    let answered = 0;
    while (answered < 7) {
      for (const w of workers) if (w.pending > 0) { w.answer(answered / 10); answered++; }
    }
    const r = await done;
    expect(r.version).toBe(7);
    expect(r.parent?.score).toBeDefined();
    expect(r.candidates.filter((c) => c.kind === 'like').map((c) => c.genome[0]).sort()).toEqual([1, 2, 3]);
    expect(r.candidates.filter((c) => c.kind === 'dislike')).toHaveLength(3);
    expect(r.seconds).toBe(2.5);
  });

  it('brings workers up one at a time, each after the last is ready', async () => {
    const workers: FakeWorker[] = [];
    let readyHeld = true;
    const held: FakeWorker[] = [];
    const p = new ScoutPool({
      size: 3,
      module: async () => EMPTY_MODULE,
      makeWorker: () => {
        const w = new FakeWorker();
        const post = w.postMessage.bind(w);
        w.postMessage = (m: ScoutWorkerIn) => { if (m.type === 'init' && readyHeld) { w.inbox.push(m); held.push(w); } else post(m); };
        workers.push(w);
        return w;
      },
    });
    void p.run(job(1));
    await flush();
    expect(workers).toHaveLength(1); // the second waits for the first
    readyHeld = false;
    held[0].onmessage?.(new MessageEvent('message', { data: { type: 'ready' } }));
    await flush();
    expect(workers).toHaveLength(3);
    p.terminate();
  });

  it('a cancel settles the job at once, and late results of it are ignored', async () => {
    const { p, workers } = pool(2);
    const first = p.run(job(1));
    await flush();
    workers[0].answer(0.5); // one unit scored
    p.cancel();
    const r = await first;
    expect(r.version).toBe(CANCELLED);
    expect(r.candidates.length + (r.parent ? 1 : 0)).toBe(1); // what was scored, no more
    // the next job reuses the workers; the old unit still out is ignored
    const second = p.run(job(2));
    await flush();
    workers[1].answer(0.9); // a unit of job 1 coming back late
    let n = 0;
    while (n < 7) for (const w of workers) if (w.pending > 0) { w.answer(0.1); n++; }
    const r2 = await second;
    expect(r2.version).toBe(2);
    expect(r2.candidates).toHaveLength(6);
    expect(workers).toHaveLength(2); // no new workers
  });
});
