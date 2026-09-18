// Simulation grid sizing (pure). The grid matches the canvas aspect so
// texels are square on screen — a square grid on a tall phone canvas would
// stretch every reaction-diffusion blob vertically.

const MIN_SIDE = 32;

export interface GridSize {
  width: number;
  height: number;
}

/** Long side = res, short side scaled by the canvas aspect. */
export function gridSize(res: number, canvasWidth: number, canvasHeight: number): GridSize {
  if (!(canvasWidth > 0) || !(canvasHeight > 0)) return { width: res, height: res };
  const aspect = canvasWidth / canvasHeight;
  if (aspect >= 1) return { width: res, height: Math.max(MIN_SIDE, Math.round(res / aspect)) };
  return { width: Math.max(MIN_SIDE, Math.round(res * aspect)), height: res };
}
