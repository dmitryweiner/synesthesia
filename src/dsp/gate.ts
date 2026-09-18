// Gate for a disabled generator: fade to silence, after which the worklet
// stops computing samples at all (audio-thread CPU). Full fade takes
// FADE_BLOCKS blocks of 128 samples (~13 ms at 48 kHz).
const FADE_BLOCKS = 5;

export const FADE_STEP = 1 / (FADE_BLOCKS * 128);

/** Silence without computing: fade finished and generator disabled. */
export function gateIsSilent(fade: number, enabled: boolean): boolean {
  return fade === 0 && !enabled;
}

/**
 * Moves fade toward its target (enabled → 1, disabled → 0), multiplying the
 * buffer. Returns the new fade. Buffer is untouched when fade is at target.
 */
export function applyGate(buf: Float32Array, fade: number, enabled: boolean): number {
  const target = enabled ? 1 : 0;
  if (fade === target) return fade;
  const d = target > fade ? FADE_STEP : -FADE_STEP;
  let f = fade;
  for (let i = 0; i < buf.length; i++) {
    f += d;
    if (f > 1) f = 1;
    else if (f < 0) f = 0;
    buf[i] *= f;
  }
  return f;
}
