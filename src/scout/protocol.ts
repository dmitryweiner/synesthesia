// The scout's job as the core's session hands it out (a `startScout`
// effect, syn-wasm session.rs), its units, and the result it takes back.

export interface ScoutSettings { seconds: number; sampleRate: number; masterGain: number; seed: number }

export interface ScoutJob {
  version: number;
  parent: number[];
  likes: number[][];
  dislikes: number[][];
  settings: ScoutSettings;
}

/** The fractality analysis of one render (the core's SoundAnalysis). A
 *  silent render has nulls where its numbers are not finite. */
export interface ScoutAnalysis {
  silent: boolean;
  loudness: number | null;
  envBeta: number | null;
  centroidBeta: number | null;
  envHiguchi: number | null;
  boxDim: number | null;
  score: number | null;
}

export type ScoutKind = 'parent' | 'like' | 'dislike';

/** Main thread → worker. */
export type ScoutWorkerIn =
  | { type: 'init'; module: WebAssembly.Module }
  | { type: 'score'; id: number; genome: number[]; settings: ScoutSettings };

/** Worker → main thread. */
export type ScoutWorkerOut = { type: 'scored'; id: number; analysis: ScoutAnalysis } | { type: 'failed'; id: number; error: string };

/** What WebSession.scoutFinished() takes. */
export interface ScoutResultJson {
  version: number;
  seconds: number;
  parent: ScoutAnalysis | null;
  candidates: { kind: 'like' | 'dislike'; genome: number[]; analysis: ScoutAnalysis }[];
}

export function isScoutWorkerOut(d: unknown): d is ScoutWorkerOut {
  return typeof d === 'object' && d !== null && 'type' in d && (d.type === 'scored' || d.type === 'failed') && 'id' in d && typeof d.id === 'number';
}
