// Explicit sound → image effects (pure; PLAN.md decision 8). Unlike the
// card couplings in src/coupling.ts, which nudge simulation params and show
// up with the simulation's lag, these act on the displayed frame directly:
//   pulse — exposure follows the loudness swell (louder than a moment ago →
//           brighter, quieter → dimmer)
//   flash — the onset envelope flares the highlights
//   tint  — bass / mid / treble levels tint dark / mid / light tones
// plus ripples: each onset hit (OnsetDetector) seeds growth at a random spot
// and a ripple spreads out from it (RippleSet feeds the display shader).
import type { AudioFeatures } from './audio/features';

export interface DisplayFx {
  /** Brightness multiplier, 1 = unchanged. */
  exposure: number;
  /** Highlight flare, 0..1. */
  flash: number;
  /** Tint strengths for [dark, mid, light] tones, each 0..1. */
  tint: readonly [number, number, number];
}

export const NEUTRAL_DISPLAY: Readonly<DisplayFx> = { exposure: 1, flash: 0, tint: [0, 0, 0] };

const PULSE_GAIN = 0.6; // exposure ±60% at full swell and full gene

export function displayCoupling(features: Readonly<AudioFeatures>, coupling: Readonly<Record<string, number>>): DisplayFx {
  const pulse = coupling.loudToPulse ?? 0;
  const flash = coupling.onsetToFlash ?? 0;
  const tint = coupling.spectrumToTint ?? 0;
  return {
    exposure: 1 + PULSE_GAIN * pulse * features.swell,
    flash: flash * features.onset,
    tint: [tint * features.low, tint * features.mid, tint * features.high],
  };
}

export interface Ripple {
  x: number;   // UV, 0..1
  y: number;
  age: number; // seconds since the hit
  amp: number; // 0..1
}

export const MAX_RIPPLES = 4;
export const RIPPLE_LIFE = 1.6; // s

interface RippleStart {
  x: number;
  y: number;
  amp: number;
  t0: number;
}

/** A small FIFO of live ripples (oldest dropped first). */
export class RippleSet {
  private list: RippleStart[] = [];

  add(x: number, y: number, amp: number, t: number): void {
    this.list.push({ x, y, amp, t0: t });
    if (this.list.length > MAX_RIPPLES) this.list.shift();
  }

  active(t: number): Ripple[] {
    this.list = this.list.filter((r) => t - r.t0 < RIPPLE_LIFE);
    return this.list.map((r) => ({ x: r.x, y: r.y, age: Math.max(0, t - r.t0), amp: r.amp }));
  }

  /** Flat (x, y, age, amp) × MAX_RIPPLES for a vec4 uniform array; unused slots are zeros. */
  pack(t: number): Float32Array {
    const out = new Float32Array(MAX_RIPPLES * 4);
    this.active(t).forEach((r, i) => out.set([r.x, r.y, r.age, r.amp], i * 4));
    return out;
  }
}
