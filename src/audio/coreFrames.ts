// The feature frames the core's worklet posts (src/core/protocol.ts), kept
// for the picture: what is HEARD now is a frame or two behind what was
// rendered (the device buffers ahead), so the picture asks for the frame at
// the played time — syn-player's frame_at, on this side of the port. Pure.
import { FRAME, FRAME_LEN } from '../core/protocol';
import type { AudioFeatures } from './features';

const RING = 64; // ~1.3 s of frames: far more than any device buffers ahead

export class CoreFrames {
  private readonly ring: Float64Array[] = [];
  private seenHits = -1;

  push(f: Float64Array): void {
    if (f.length !== FRAME_LEN) return;
    if (this.ring.length === RING) this.ring.shift();
    this.ring.push(f);
  }

  clear(): void {
    this.ring.length = 0;
    this.seenHits = -1;
  }

  /** The latest frame stamped at or before `t` (engine seconds), else the oldest. */
  at(t: number): Float64Array | null {
    for (let i = this.ring.length - 1; i >= 0; i--) if (this.ring[i][FRAME.time] <= t) return this.ring[i];
    return this.ring[0] ?? null;
  }

  /** The features of the frame heard at `t`. */
  features(t: number): AudioFeatures | null {
    const f = this.at(t);
    if (!f) return null;
    return {
      loudness: f[FRAME.loudness], swell: f[FRAME.swell], brightness: f[FRAME.brightness],
      onset: f[FRAME.onset], low: f[FRAME.low], mid: f[FRAME.mid], high: f[FRAME.high],
    };
  }

  /** True once per new onset hit heard by `t` (several in one frame count once). */
  hitHeard(t: number): boolean {
    const f = this.at(t);
    if (!f) return false;
    const hits = f[FRAME.hits];
    const first = this.seenHits < 0;
    const fresh = !first && hits > this.seenHits;
    if (first || hits > this.seenHits) this.seenHits = hits;
    return fresh;
  }
}
