// SimEngine: owns the GL context, the ping-pong state, and every GPU
// program (seed/react/display/velocity/advect/paramfield/inject). Per rendered
// frame: recompute paramfield + velocity (cheap), run `reaction.speed`
// Gray-Scott substeps, then one advection substep. No determinism is
// attempted — reseed() re-rolls Math.random(). Ported from chromaflux
// without the Veins/Pour/Brush layers.
import { createGL2, createProgram, composeFragmentShader } from '../gl/context';
import { PingPongTarget, SingleTarget } from '../gl/pingpong';
import { FULLSCREEN_VERT, runPass, u1f, u1i, u2f, u2fv, u3f, u4fv, utex } from '../gl/quad';
import type { PaletteUniforms } from '../palette';
import type { DisplayFx } from '../visualFx';
import { MAX_RIPPLES, NEUTRAL_DISPLAY } from '../visualFx';
import type { FieldVariationParams, FlowParams, ReactionParams } from './params';
import { DEFAULT_REACTION_PARAMS, ZERO_FIELD_VARIATION, ZERO_FLOW } from './params';
import commonGlsl from './shaders/common.glsl?raw';
import seedFrag from './shaders/seed.frag?raw';
import reactFrag from './shaders/react.frag?raw';
import displayFrag from './shaders/display.frag?raw';
import velocityFrag from './shaders/velocity.frag?raw';
import advectFrag from './shaders/advect.frag?raw';
import paramfieldFrag from './shaders/paramfield.frag?raw';
import injectFrag from './shaders/inject.frag?raw';

const MAX_SPOTS = 24;
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

  private readonly seedProgram: WebGLProgram;
  private readonly reactProgram: WebGLProgram;
  private readonly displayProgram: WebGLProgram;
  private readonly velocityProgram: WebGLProgram;
  private readonly advectProgram: WebGLProgram;
  private readonly paramfieldProgram: WebGLProgram;
  private readonly injectProgram: WebGLProgram;
  private readonly noRipples = new Float32Array(MAX_RIPPLES * 4);

  constructor(opts: SimEngineOptions) {
    const gl = createGL2(opts.canvas);
    this.gl = gl;
    this.state = new PingPongTarget(gl, opts.width, opts.height);
    this.velocity = new SingleTarget(gl, opts.width, opts.height);
    this.paramField = new SingleTarget(gl, opts.width, opts.height);
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
  private get aspect(): number {
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

  private updateParamField(): void {
    const f = this.fieldVariation;
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
  }

  private updateVelocity(): void {
    const flow = this.flow;
    // Canvas UV is Y-up, so "down" (what a positive Drift Y should mean) is -Y.
    runPass(this.gl, this.velocityProgram, {
      uCurlStrength: u1f(flow.curlStrength),
      uCurlScale: u1f(flow.curlScale),
      uDrift: u2f(flow.driftX, -flow.driftY),
      uEvolveT: u1f(this.evolveT),
      uAspect: u1f(this.aspect),
    }, this.velocity.target);
  }

  /** Recomputes paramfield/velocity, runs `reaction.speed` substeps, then one advection substep. */
  step(): void {
    this.evolveT += this.flow.evolveRate * EVOLVE_DT;
    this.updateParamField();
    this.updateVelocity();

    const texel: readonly [number, number] = [1 / this.state.width, 1 / this.state.height];
    const substeps = Math.max(1, Math.round(this.reaction.speed));
    for (let i = 0; i < substeps; i++) {
      runPass(this.gl, this.reactProgram, {
        uState: utex(this.state.readTexture, 0),
        uParamField: utex(this.paramField.texture, 1),
        uTexel: u2f(texel[0], texel[1]),
        uFeed: u1f(this.reaction.feed),
        uKill: u1f(this.reaction.kill),
        uDiffU: u1f(this.reaction.diffU),
        uDiffV: u1f(this.reaction.diffV),
        uDt: u1f(1.0),
      }, this.state.writeTarget);
      this.state.swap();
    }

    runPass(this.gl, this.advectProgram, {
      uState: utex(this.state.readTexture, 0),
      uVelocity: utex(this.velocity.texture, 1),
      uAdvectAmount: u1f(this.flow.advectAmount),
    }, this.state.writeTarget);
    this.state.swap();
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
    runPass(this.gl, this.displayProgram, {
      uState: utex(this.state.readTexture, 0),
      uTexel: u2f(texel[0], texel[1]),
      uPalA: u3f(palette.a[0], palette.a[1], palette.a[2]),
      uPalB: u3f(palette.b[0], palette.b[1], palette.b[2]),
      uPalC: u3f(palette.c[0], palette.c[1], palette.c[2]),
      uPalD: u3f(palette.d[0], palette.d[1], palette.d[2]),
      uBands: u1f(palette.bands),
      uRelief: u1f(palette.relief),
      uLightAngle: u1f(palette.lightAngle),
      uGloss: u1f(palette.gloss),
      uAspect: u1f(this.aspect),
      uExposure: u1f(fx.exposure),
      uFlash: u1f(fx.flash),
      uTint: u3f(fx.tint[0], fx.tint[1], fx.tint[2]),
      uRipples: u4fv(ripples ?? this.noRipples),
    }, null);
  }

  /** Changes the simulation grid size, preserving the current pattern (blit). */
  setGrid(width: number, height: number): void {
    if (width === this.state.width && height === this.state.height) return;
    this.state.resize(width, height);
    this.velocity.resize(width, height);
    this.paramField.resize(width, height);
  }
}
