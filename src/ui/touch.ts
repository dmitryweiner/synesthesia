// Touch / click on the canvas (pure part). People asked for the picture to
// answer a finger the way ../chromaflux's Brush card does — but this app has
// no parameter UI at all (👍/👎/🎲 and nothing else), so there is nowhere to
// put a mode selector, and PLAN.md #2 deliberately left Brush unported.
//
// It does not need one: the picture already knows how to react to a moment
// in time. An onset hit drops fresh "ink" into the reaction and sends a
// ripple out from it (PLAN.md #8, src/visualFx.ts). A touch is the same
// event with the finger as its source, so it runs the same two passes —
// which is also why it needs no new gene and no new shader.

/** The part of a DOMRect this module needs (so it stays testable in node). */
export interface CanvasRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * Pointer coordinates → canvas UV. The canvas is Y-up (see the fullscreen
 * triangle in gl/quad.ts) and the DOM is Y-down, so Y flips here. Clamped:
 * a captured pointer keeps painting at the edge after it leaves the canvas.
 */
export function canvasUv(rect: CanvasRect, clientX: number, clientY: number): [number, number] {
  const clamp01 = (x: number) => (Number.isFinite(x) ? Math.min(1, Math.max(0, x)) : 0);
  return [
    clamp01((clientX - rect.left) / rect.width),
    clamp01(1 - (clientY - rect.top) / rect.height),
  ];
}

/**
 * Where to stamp between the previous frame's pointer position and this
 * one. A drag is sampled once per frame, and this app can be at 10 fps on a
 * machine with no GPU, where a finger crosses a third of the screen between
 * two frames — stamping only the current position would leave a dotted
 * trail instead of a stroke.
 *
 * `aspect` (grid width / height) makes the spacing a screen distance rather
 * than a UV one, the same correction inject.frag applies to keep its disc
 * round. `from` is never returned: the previous frame already stamped it.
 */
export function strokePoints(
  from: readonly [number, number],
  to: readonly [number, number],
  spacing: number,
  aspect: number,
  max: number,
): [number, number][] {
  const dx = (to[0] - from[0]) * aspect;
  const dy = to[1] - from[1];
  const steps = Math.min(max, Math.max(1, Math.ceil(Math.hypot(dx, dy) / spacing)));
  const out: [number, number][] = [];
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    out.push([from[0] + (to[0] - from[0]) * t, from[1] + (to[1] - from[1]) * t]);
  }
  return out;
}

// Fixed, not taken from the point's `onsetToSeed` coupling (agreed with the
// user): people asked for a reaction, and a point that happens to have
// evolved a weak onset coupling must not read as a broken app.
export const TOUCH_RADIUS = 0.035;
export const TOUCH_AMOUNT = 0.85;
/** Stamps are this far apart along a drag, and at most this many per frame. */
export const TOUCH_SPACING = TOUCH_RADIUS * 0.6;
export const TOUCH_MAX_STAMPS = 8;
