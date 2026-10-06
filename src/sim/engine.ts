// SimEngine: owns the GL context, the ping-pong state, and every GPU
// program (seed/react/display/velocity/advect/paramfield/inject). It draws
// what the core's picture driver decides (PLAN-CORE.md phase 5, syn-wasm
// WebPicture → src/core/picture.ts): per frame, the injects, then
// paramfield + velocity, the reaction's substeps and one advection substep,
// then the display pass. The seed spots come from the core too. The shaders
// are the core's (C10), from the package built at the pinned revision.
//
// None of those passes is cheap where there is no GPU (a 1080p board with
// only a display controller renders all of them on the same CPU cores), so
// the engine does the three things a GPU lets you skip thinking about:
//   * it does not run a pass whose output would change nothing — an off
//     Field variation card gets a 1x1 zero texture, and advection with no
//     amount or a zero velocity is an identity copy of the state;
//   * it reuses the last paramfield/velocity while their inputs are
//     unchanged (both are pure functions of their params and evolveT);
//   * it renders both of them at half the grid's side (src/sim/grid.ts).
// Numbers behind this: src/sim/quality.ts and `analyze.mjs --render`.
import { createGL2, createProgram, composeFragmentShader } from '../gl/context';
import { PingPongTarget, SingleTarget, createZeroTexture } from '../gl/pingpong';
import { FULLSCREEN_VERT, runPass, u1f, u1i, u2f, u2fv, u3f, u4fv, utex } from '../gl/quad';
import { packRipples, type PictureFrame, type SeedSpots } from '../core/picture';
import { fieldGrid, maxRipples, maxSeedSpots } from '../core/pkg/syn_wasm.js';
import commonGlsl from '../core/pkg/shaders/common.glsl?raw';
import seedFrag from '../core/pkg/shaders/seed.frag?raw';
import reactFrag from '../core/pkg/shaders/react.frag?raw';
import displayFrag from '../core/pkg/shaders/display.frag?raw';
import velocityFrag from '../core/pkg/shaders/velocity.frag?raw';
import advectFrag from '../core/pkg/shaders/advect.frag?raw';
import paramfieldFrag from '../core/pkg/shaders/paramfield.frag?raw';
import injectFrag from '../core/pkg/shaders/inject.frag?raw';

/** The paramfield and velocity textures: half the grid each side. */
function fieldGridSize(g: { width: number; height: number }): { width: number; height: number } {
  const [width, height] = fieldGrid(g.width, g.height);
  return { width, height };
}

/**
 * True when `key` already holds `next`; otherwise copies `next` in and
 * returns false. One call decides both "may I reuse the texture?" and
 * "remember what I am about to draw".
 */
function unchanged(key: Float64Array, next: readonly number[]): boolean {
  let same = true;
  for (let i = 0; i < next.length; i++) {
    if (key[i] !== next[i]) {
      same = false;
      key[i] = next[i];
    }
  }
  return same;
}


export interface SimEngineOptions {
  canvas: HTMLCanvasElement;
  width: number;
  height: number;
}

export class SimEngine {
  readonly gl: WebGL2RenderingContext;

  private state: PingPongTarget;
  private velocity: SingleTarget;
  private paramField: SingleTarget;
  /** The uniforms each field texture currently holds; empty until it is drawn. */
  private readonly paramFieldKey = new Float64Array(8);
  private readonly velocityKey = new Float64Array(6);
  private paramFieldDrawn = false;
  private velocityDrawn = false;

  private readonly seedProgram: WebGLProgram;
  private readonly reactProgram: WebGLProgram;
  private readonly displayProgram: WebGLProgram;
  private readonly velocityProgram: WebGLProgram;
  private readonly advectProgram: WebGLProgram;
  private readonly paramfieldProgram: WebGLProgram;
  private readonly injectProgram: WebGLProgram;
  private readonly ripples: Float32Array<ArrayBuffer>;
  private readonly zeroField: WebGLTexture;
  private readonly syncPixel = new Uint8Array(4);

  constructor(opts: SimEngineOptions) {
    const gl = createGL2(opts.canvas);
    this.gl = gl;
    this.state = new PingPongTarget(gl, opts.width, opts.height);
    const field = fieldGridSize({ width: opts.width, height: opts.height });
    this.velocity = new SingleTarget(gl, field.width, field.height);
    this.paramField = new SingleTarget(gl, field.width, field.height);
    this.zeroField = createZeroTexture(gl);
    this.seedProgram = createProgram(gl, FULLSCREEN_VERT, composeFragmentShader(commonGlsl, seedFrag));
    this.reactProgram = createProgram(gl, FULLSCREEN_VERT, composeFragmentShader(commonGlsl, reactFrag));
    this.displayProgram = createProgram(gl, FULLSCREEN_VERT, composeFragmentShader(commonGlsl, displayFrag));
    this.velocityProgram = createProgram(gl, FULLSCREEN_VERT, composeFragmentShader(commonGlsl, velocityFrag));
    this.advectProgram = createProgram(gl, FULLSCREEN_VERT, composeFragmentShader(commonGlsl, advectFrag));
    this.paramfieldProgram = createProgram(gl, FULLSCREEN_VERT, composeFragmentShader(commonGlsl, paramfieldFrag));
    this.injectProgram = createProgram(gl, FULLSCREEN_VERT, composeFragmentShader(commonGlsl, injectFrag));
    this.ripples = new Float32Array(maxRipples() * 4);
  }

  /** Grid width / height: noise and seed spots are laid out in aspect-corrected UV. */
  get aspect(): number {
    return this.state.width / this.state.height;
  }

  /** Paints a fresh start from the core's seed spots into BOTH buffers. */
  reseed(seed: SeedSpots): void {
    const max = maxSeedSpots();
    const spots = new Float32Array(max * 2);
    spots.set(seed.xy.slice(0, max * 2));
    const uniforms = {
      uSpotCount: u1i(Math.min(seed.count, max)),
      uSpots: u2fv(spots),
      uSpotRadius: u1f(seed.radius),
      uAspect: u1f(this.aspect),
    };
    runPass(this.gl, this.seedProgram, uniforms, this.state.writeTarget);
    this.state.swap();
    runPass(this.gl, this.seedProgram, uniforms, this.state.writeTarget);
    this.state.swap();
  }

  /**
   * The feed/kill offset texture to hand to the reaction — redrawn only when
   * it would come out different. Ten fbm4 evaluations per cell, so "it would
   * come out all zeros anyway" (the core's `active`) is worth a branch.
   */
  private updateParamField(f: PictureFrame): WebGLTexture {
    const v = f.fieldVariation;
    if (!v.active) return this.zeroField;
    const same = unchanged(this.paramFieldKey, [
      v.feedAmount, v.feedScale, v.feedWarp, v.killAmount, v.killScale, v.killWarp, f.evolveT, this.aspect,
    ]);
    if (same && this.paramFieldDrawn) return this.paramField.texture;
    runPass(this.gl, this.paramfieldProgram, {
      uFeedVarAmount: u1f(v.feedAmount),
      uFeedVarScale: u1f(v.feedScale),
      uFeedVarWarp: u1f(v.feedWarp),
      uKillVarAmount: u1f(v.killAmount),
      uKillVarScale: u1f(v.killScale),
      uKillVarWarp: u1f(v.killWarp),
      uEvolveT: u1f(f.evolveT),
      uAspect: u1f(this.aspect),
    }, this.paramField.target);
    this.paramFieldDrawn = true;
    return this.paramField.texture;
  }

  /** Same deal for the advection velocity; only called when advection runs. */
  private updateVelocity(f: PictureFrame): void {
    const flow = f.flow;
    const same = unchanged(this.velocityKey, [
      flow.curlStrength, flow.curlScale, flow.driftX, flow.driftY, f.evolveT, this.aspect,
    ]);
    if (same && this.velocityDrawn) return;
    runPass(this.gl, this.velocityProgram, {
      uCurlStrength: u1f(flow.curlStrength),
      uCurlScale: u1f(flow.curlScale),
      uDrift: u2f(flow.driftX, flow.driftY), // already Y-up
      uEvolveT: u1f(f.evolveT),
      uAspect: u1f(this.aspect),
    }, this.velocity.target);
    this.velocityDrawn = true;
  }

  /** One frame of the simulation: the injects, then paramfield/velocity,
   *  the reaction's substeps and one advection substep. */
  step(f: PictureFrame): void {
    for (const [x, y, radius, amount] of f.injects) this.inject([x, y], radius, amount);
    const paramField = this.updateParamField(f);
    const advecting = f.flow.advecting;
    if (advecting) this.updateVelocity(f);

    const rx = f.reaction;
    for (let i = 0; i < Math.max(1, rx.substeps); i++) {
      runPass(this.gl, this.reactProgram, {
        uState: utex(this.state.readTexture, 0),
        uParamField: utex(paramField, 1),
        uFeed: u1f(rx.feed),
        uKill: u1f(rx.kill),
        uDiffU: u1f(rx.diffU),
        uDiffV: u1f(rx.diffV),
        uDt: u1f(1.0),
      }, this.state.writeTarget);
      this.state.swap();
    }

    if (advecting) {
      runPass(this.gl, this.advectProgram, {
        uState: utex(this.state.readTexture, 0),
        uVelocity: utex(this.velocity.texture, 1),
        uAdvectAmount: u1f(f.flow.advectAmount),
      }, this.state.writeTarget);
      this.state.swap();
    }
  }

  /** Drops fresh "ink" into a disc at uv (0..1, Y-up). amount 0..1. */
  inject(uv: readonly [number, number], radius: number, amount: number): void {
    runPass(this.gl, this.injectProgram, {
      uState: utex(this.state.readTexture, 0),
      uCenter: u2f(uv[0], uv[1]),
      uRadius: u1f(radius),
      uAmount: u1f(amount),
      uAspect: u1f(this.aspect),
    }, this.state.writeTarget);
    this.state.swap();
  }

  /** Draws the current state to the canvas (default framebuffer) with the
   *  frame's palette, sound→image display effects and ripples. */
  render(f: PictureFrame): void {
    const texel: readonly [number, number] = [1 / this.state.width, 1 / this.state.height];
    const { palette: pal, display: fx } = f;
    runPass(this.gl, this.displayProgram, {
      uState: utex(this.state.readTexture, 0),
      uTexel: u2f(texel[0], texel[1]),
      uPalA: u3f(pal.a[0], pal.a[1], pal.a[2]),
      uPalB: u3f(pal.b[0], pal.b[1], pal.b[2]),
      uPalC: u3f(pal.c[0], pal.c[1], pal.c[2]),
      uPalD: u3f(pal.d[0], pal.d[1], pal.d[2]),
      uBands: u1f(pal.bands),
      uRelief: u1f(pal.relief),
      uLightDir: u3f(pal.lightDir[0], pal.lightDir[1], pal.lightDir[2]),
      uGloss: u1f(pal.gloss),
      uAspect: u1f(this.aspect),
      uExposure: u1f(fx.exposure),
      uFlash: u1f(fx.flash),
      uTint: u3f(fx.tint[0], fx.tint[1], fx.tint[2]),
      uRipples: u4fv(packRipples(f, this.ripples)),
    }, null);
  }

  /**
   * Blocks until everything drawn so far has actually been rasterized.
   * GL commands are queued to another process, so the frame loop can run far
   * ahead of what is on screen: without this, timing the loop measures how
   * fast frames are ENQUEUED (the same configuration reads as 0.3 fps or
   * 2.9 fps depending on how deep the queue is). gl.finish() does not do it
   * — it returns before the raster has happened — but a 1-pixel read has to
   * hand back real pixels. Used only by the boot probe, which would
   * otherwise pick a rung the machine cannot hold.
   */
  syncFrame(): void {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, this.syncPixel);
  }

  /**
   * The state's V channel (the "ink"), row by row — for analyze.mjs
   * --picture (PLAN.md #22). A full-grid readback that stalls the pipeline:
   * never call it from the frame loop.
   */
  readState(): { width: number; height: number; v: Float32Array } {
    const gl = this.gl;
    const { width, height } = this.state;
    const rgba = new Float32Array(width * height * 4);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.state.readFramebuffer);
    gl.readPixels(0, 0, width, height, gl.RGBA, gl.FLOAT, rgba);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    const v = new Float32Array(width * height);
    for (let i = 0; i < v.length; i++) v[i] = rgba[i * 4 + 1];
    return { width, height, v };
  }

  /** Changes the simulation grid size, preserving the current pattern (blit). */
  setGrid(width: number, height: number): void {
    if (width === this.state.width && height === this.state.height) return;
    this.state.resize(width, height);
    const field = fieldGridSize({ width, height });
    this.velocity.resize(field.width, field.height);
    this.paramField.resize(field.width, field.height);
    this.paramFieldDrawn = false; // new textures: whatever the keys say, they are empty
    this.velocityDrawn = false;
  }
}
