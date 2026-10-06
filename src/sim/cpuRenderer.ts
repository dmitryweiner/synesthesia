// The picture without WebGL2 float targets (PLAN-CORE.md C8): the core's
// CPU Picture draws the very frame the driver handed out, into a 2D canvas
// from the main thread's wasm. Slower than the GPU path by far, so it draws
// small and lets CSS scale it up; the same seeded field on both paths is
// compared in scripts/smoke.mjs.
import type { PictureFrame, SeedSpots, WebPicture } from '../core/picture';

/** What the frame loop asks of a renderer, GPU or CPU. */
export interface Renderer {
  readonly aspect: number;
  reseed(seed: SeedSpots): void;
  step(f: PictureFrame): void;
  render(f: PictureFrame): void;
  setGrid(width: number, height: number): void;
  syncFrame(): void;
  readState(): { width: number; height: number; v: Float32Array };
}

/** The CPU picture's long side, pixels: its grid follows at its own density. */
export const CPU_LONG_SIDE = 160;

export class CpuRenderer implements Renderer {
  private readonly ctx: CanvasRenderingContext2D;
  private readonly width: number;
  private readonly height: number;

  constructor(private readonly canvas: HTMLCanvasElement, private readonly picture: WebPicture, seed: number) {
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('no 2D canvas either');
    this.ctx = ctx;
    const rect = canvas.getBoundingClientRect();
    const k = CPU_LONG_SIDE / Math.max(1, rect.width, rect.height);
    this.width = Math.max(16, Math.round(rect.width * k));
    this.height = Math.max(16, Math.round(rect.height * k));
    canvas.width = this.width;
    canvas.height = this.height;
    picture.useCpu(seed, this.width, this.height);
  }

  get aspect(): number {
    const [w, h] = this.picture.cpuGrid();
    return w / h;
  }

  reseed(seed: SeedSpots): void {
    this.picture.cpuSeed(new Float32Array(seed.xy), seed.radius);
  }

  /** The CPU picture advances and draws in one call, in render(). */
  step(_f: PictureFrame): void {}

  render(_f: PictureFrame): void {
    const rgba = this.picture.cpuFrame();
    if (rgba.length !== this.width * this.height * 4) return;
    this.ctx.putImageData(new ImageData(new Uint8ClampedArray(rgba), this.width, this.height), 0, 0);
  }

  /** Its size is its own: the canvas keeps the CPU picture's pixels. */
  setGrid(_width: number, _height: number): void {
    this.canvas.width = this.width;
    this.canvas.height = this.height;
  }

  syncFrame(): void {}

  readState(): { width: number; height: number; v: Float32Array } {
    const [width, height] = this.picture.cpuGrid();
    return { width, height, v: this.picture.cpuInk() };
  }
}
