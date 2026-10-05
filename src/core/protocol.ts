// What the main thread and the core's AudioWorklet (src/worklet/core.ts)
// say to each other. No imports: both sides load it.

export const CORE_PROCESSOR = 'synesthesia-core';

/** What the main thread sends. Points are AppState v1 JSON as UTF-8. */
export type CoreCommand =
  | { type: 'switchTo' | 'setPoint'; point: Uint8Array }
  | { type: 'fadeIn' | 'fadeOut' }
  | { type: 'stats'; reset?: boolean }
  /** Render `quanta` × 128 samples of `point` on a separate player, timed. */
  | { type: 'bench'; point: Uint8Array; quanta: number }
  /** A stress test: `count` more players of `point` render every quantum
   *  beside the live one and are thrown away (0 removes them). Whether the
   *  thread then keeps up is a measure of headroom that needs no clock. */
  | { type: 'ballast'; point: Uint8Array; count: number };

/** Load of the live render since the last reset, timed with Date.now(): its
 *  1 ms steps fall at random phases of the quantum, so a sum over many
 *  quanta is unbiased even though one quantum is ~2.7 ms. */
export interface CoreStats {
  type: 'stats';
  quanta: number;
  frames: number;
  renderMs: number;
  /** The longest wall time between the starts of two process() calls. */
  maxGapMs: number;
  /** process() calls that came > 50 ms after the previous one — an audible gap. */
  longGaps: number;
  /** How many times the output view was (re)made — 1 unless the memory grew. */
  views: number;
  /** Ballast players rendering beside the live one. */
  ballast: number;
  time: number;
}

export interface CoreBenchResult { type: 'bench'; quanta: number; ms: number; ok: boolean }

export interface CoreProcessorOptions {
  module?: WebAssembly.Module;
  bytes?: ArrayBuffer;
  point: Uint8Array;
}

function hasType(d: unknown, type: string): d is { type: string } {
  return typeof d === 'object' && d !== null && 'type' in d && d.type === type;
}

export function isCoreStats(d: unknown): d is CoreStats {
  return hasType(d, 'stats') && 'renderMs' in d && typeof d.renderMs === 'number';
}

export function isCoreBenchResult(d: unknown): d is CoreBenchResult {
  return hasType(d, 'bench') && 'ok' in d && typeof d.ok === 'boolean';
}
