// SimEngine: owns the GL context, the ping-pong state, and every GPU
// program (seed/react/display/velocity/advect/paramfield/inject). Per rendered
// frame: refresh paramfield + velocity, run `reaction.speed` Gray-Scott
// substeps, then one advection substep. No determinism is attempted —
// reseed() re-rolls Math.random(). Ported from chromaflux without the
// Veins/Pour/Brush layers.
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
import type { PaletteUniforms } from '../palette';
import type { DisplayFx } from '../visualFx';
import { MAX_RIPPLES, NEUTRAL_DISPLAY } from '../visualFx';
import { fieldGridSize } from './grid';
import type { FieldVariationParams, FlowParams, ReactionParams } from './params';
import { DEFAULT_REACTION_PARAMS, ZERO_FIELD_VARIATION, ZERO_FLOW, advectActive, paramFieldActive } from './params';
import commonGlsl from './shaders/common.glsl?raw';
import seedFrag from './shaders/seed.frag?raw';
import reactFrag from './shaders/react.frag?raw';
import displayFrag from './shaders/display.frag?raw';
import velocityFrag from './shaders/velocity.frag?raw';
import advectFrag from './shaders/advect.frag?raw';
import paramfieldFrag from './shaders/paramfield.frag?raw';
import injectFrag from './shaders/inject.frag?raw';

const MAX_SPOTS = 24;
const LIGHT_Z = 0.6;

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

/** The display pass's light vector. Trig on a uniform, per pixel, is not free. */
function lightDir(angle: number): [number, number, number] {
  const x = Math.cos(angle);
  const y = Math.sin(angle);
  const len = Math.hypot(x, y, LIGHT_Z);
  return [x / len, y / len, LIGHT_Z / len];
}

const EVOLVE_DT = 1 / 60; // nominal frame time; evolveT is an aesthetic drift, not a clock

export interface SimEngineOptions {
  canvas: HTMLCanvasElement;
  width: number;
  height: number;
}

export class SimEngine {
  readonly gl: WebGL2RenderingContext;
  reaction: ReactionParams = { ...DEFAULT_REACTION_PARAMS };
  fieldVariation: FieldVariationParams = { ...ZERO_FIELD_VARIATION };
  flow: FlowParams = { ...ZERO_FLOW };

  private state: PingPongTarget;
  private velocity: SingleTarget;
  private paramField: SingleTarget;
  private evolveT = 0;
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
  private readonly noRipples = new Float32Array(MAX_RIPPLES * 4);
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
    this.reseed();
  }

  /** Grid width / height: noise and seed spots are laid out in aspect-corrected UV. */
  get aspect(): number {
    return this.state.width / this.state.height;
  }

  /** Paints a fresh random start into BOTH buffers. */
  reseed(): void {
    const spotCount = MAX_SPOTS - Math.floor(Math.random() * 6);
    const spots = new Float32Array(MAX_SPOTS * 2);
    for (let i = 0; i < spotCount; i++) {
      spots[i * 2] = Math.random();
      spots[i * 2 + 1] = Math.random();
    }
    const uniforms = {
      uSpotCount: u1i(spotCount),
      uSpots: u2fv(spots),
      uSpotRadius: u1f(0.02 + Math.random() * 0.03),
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
   * come out all zeros anyway" is worth a branch.
   */
  private updateParamField(): WebGLTexture {
    const f = this.fieldVariation;
    if (!paramFieldActive(f)) return this.zeroField;
    const same = unchanged(this.paramFieldKey, [
      f.feedVarAmount, f.feedVarScale, f.feedVarWarp,
      f.killVarAmount, f.killVarScale, f.killVarWarp,
      this.evolveT, this.aspect,
    ]);
    if (same && this.paramFieldDrawn) return this.paramField.texture;
    runPass(this.gl, this.paramfieldProgram, {
      uFeedVarAmount: u1f(f.feedVarAmount),
      uFeedVarScale: u1f(f.feedVarScale),
      uFeedVarWarp: u1f(f.feedVarWarp),
      uKillVarAmount: u1f(f.killVarAmount),
      uKillVarScale: u1f(f.killVarScale),
      uKillVarWarp: u1f(f.killVarWarp),
      uEvolveT: u1f(this.evolveT),
      uAspect: u1f(this.aspect),
    }, this.paramField.target);
    this.paramFieldDrawn = true;
    return this.paramField.texture;
  }

  /** Same deal for the advection velocity; only called when advection runs. */
  private updateVelocity(): void {
    const flow = this.flow;
    const same = unchanged(this.velocityKey, [
      flow.curlStrength, flow.curlScale, flow.driftX, flow.driftY,
      this.evolveT, this.aspect,
    ]);
    if (same && this.velocityDrawn) return;
    // Canvas UV is Y-up, so "down" (what a positive Drift Y should mean) is -Y.
    runPass(this.gl, this.velocityProgram, {
      uCurlStrength: u1f(flow.curlStrength),
      uCurlScale: u1f(flow.curlScale),
      uDrift: u2f(flow.driftX, -flow.driftY),
      uEvolveT: u1f(this.evolveT),
      uAspect: u1f(this.aspect),
    }, this.velocity.target);
    this.velocityDrawn = true;
  }

  /** Refreshes paramfield/velocity, runs `reaction.speed` substeps, then one advection substep. */
  step(): void {
    this.evolveT += this.flow.evolveRate * EVOLVE_DT;
    const paramField = this.updateParamField();
    const advecting = advectActive(this.flow);
    if (advecting) this.updateVelocity();

    const substeps = Math.max(1, Math.round(this.reaction.speed));
    for (let i = 0; i < substeps; i++) {
      runPass(this.gl, this.reactProgram, {
        uState: utex(this.state.readTexture, 0),
        uParamField: utex(paramField, 1),
        uFeed: u1f(this.reaction.feed),
        uKill: u1f(this.reaction.kill),
        uDiffU: u1f(this.reaction.diffU),
        uDiffV: u1f(this.reaction.diffV),
        uDt: u1f(1.0),
      }, this.state.writeTarget);
      this.state.swap();
    }

    if (advecting) {
      runPass(this.gl, this.advectProgram, {
        uState: utex(this.state.readTexture, 0),
        uVelocity: utex(this.velocity.texture, 1),
        uAdvectAmount: u1f(this.flow.advectAmount),
      }, this.state.writeTarget);
      this.state.swap();
    }
  }

  /** Drops fresh "ink" into a disc at uv (0..1, Y-up) — onset seeding. amount 0..1. */
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

  /**
   * Draws the current state to the canvas (default framebuffer), with the
   * explicit sound→image display effects and packed ripples (RippleSet.pack).
   */
  render(palette: PaletteUniforms, fx: Readonly<DisplayFx> = NEUTRAL_DISPLAY, ripples?: Float32Array): void {
    const texel: readonly [number, number] = [1 / this.state.width, 1 / this.state.height];
    const light = lightDir(palette.lightAngle);
    runPass(this.gl, this.displayProgram, {
      uState: utex(this.state.readTexture, 0),
      uTexel: u2f(texel[0], texel[1]),
      uPalA: u3f(palette.a[0], palette.a[1], palette.a[2]),
      uPalB: u3f(palette.b[0], palette.b[1], palette.b[2]),
      uPalC: u3f(palette.c[0], palette.c[1], palette.c[2]),
      uPalD: u3f(palette.d[0], palette.d[1], palette.d[2]),
      uBands: u1f(palette.bands),
      uRelief: u1f(palette.relief),
      uLightDir: u3f(light[0], light[1], light[2]),
      uGloss: u1f(palette.gloss),
      uAspect: u1f(this.aspect),
      uExposure: u1f(fx.exposure),
      uFlash: u1f(fx.flash),
      uTint: u3f(fx.tint[0], fx.tint[1], fx.tint[2]),
      uRipples: u4fv(ripples ?? this.noRipples),
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
