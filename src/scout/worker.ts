// One scout worker (PLAN-CORE.md C4): a single-threaded instance of the
// core's wasm, rendering and scoring one genome at a time. The main thread
// sends the compiled module first, then units of a job.
import { initSync, scoutScore } from '../core/pkg/syn_wasm.js';
import type { ScoutAnalysis, ScoutWorkerIn, ScoutWorkerOut } from './protocol';

declare const self: { onmessage: ((e: MessageEvent) => void) | null; postMessage(m: ScoutWorkerOut): void };

function parse(json: string): ScoutAnalysis {
  const v: unknown = JSON.parse(json);
  if (typeof v !== 'object' || v === null || !('silent' in v) || typeof v.silent !== 'boolean') throw new Error('not an analysis');
  const n = (k: string): number | null => { const x: unknown = Reflect.get(v, k); return typeof x === 'number' ? x : null; };
  return { silent: v.silent, loudness: n('loudness'), envBeta: n('envBeta'), centroidBeta: n('centroidBeta'), envHiguchi: n('envHiguchi'), boxDim: n('boxDim'), score: n('score') };
}

self.onmessage = (e: MessageEvent) => {
  const msg: ScoutWorkerIn = e.data;
  if (msg.type === 'init') {
    initSync({ module: msg.module });
    return;
  }
  const s = msg.settings;
  try {
    const analysis = parse(scoutScore(new Float64Array(msg.genome), s.seconds, s.sampleRate, s.masterGain, s.seed));
    self.postMessage({ type: 'scored', id: msg.id, analysis });
  } catch (err) {
    self.postMessage({ type: 'failed', id: msg.id, error: err instanceof Error ? err.message : String(err) });
  }
};
