// SimEngine: owns the GL context, the ping-pong state, and every GPU
// program (seed/react/display/velocity/advect/paramfield). Per rendered
// frame: recompute paramfield + velocity (cheap), run `reaction.speed`
// Gray-Scott substeps, then one advection substep. No determinism is
// attempted — reseed() re-rolls Math.random(). Ported from chromaflux
// without the Veins/Pour/Brush layers.
import { createGL2, createProgram, composeFragmentShader } from '../gl/context';
import { PingPongTarget, SingleTarget } from '../gl/pingpong';
import { FULLSCREEN_VERT, runPass, u1f, u1i, u2f, u2fv, u3f, utex } from '../gl/quad';
import type { PaletteUniforms } from '../palette';
import type { FieldVariationParams, FlowParams, ReactionParams } from './params';
import { DEFAULT_REACTION_PARAMS, ZERO_FIELD_VARIATION, ZERO_FLOW } from './params';
import commonGlsl from './shaders/common.glsl?raw';
import seedFrag from './shaders/seed.frag?raw';
import reactFrag from './shaders/react.frag?raw';
import displayFrag from './shaders/display.frag?raw';
import velocityFrag from './shaders/velocity.frag?raw';
import advectFrag from './shaders/advect.frag?raw';
import paramfieldFrag from './shaders/paramfield.frag?raw';

const MAX_SPOTS = 24;
const EVOLVE_DT = 1 / 60; // nominal frame time; evolveT is an aesthetic drift, not a clock

export interface SimEngineOptions {
  canvas: HTMLCanvasElement;
  resolution: number;
}

export class SimEngine {
  readonly gl: WebGL2RenderingContext;
  reaction: ReactionParams = { ...DEFAULT_REACTION_PARAMS };
  fieldVariation: FieldVariationParams = { ...ZERO_FIELD_VARIATION };
  flow: FlowParams = { ...ZERO_FLOW };

  private state: PingPongTarget;
  private velocity: SingleTarget;
  private paramField: SingleTarget;
  private resolution: number;
  private evolveT = 0;

  private readonly seedProgram: WebGLProgram;
  private readonly reactProgram: WebGLProgram;
  private readonly displayProgram: WebGLProgram;
  private readonly velocityProgram: WebGLProgram;
  private readonly advectProgram: WebGLProgram;
  private readonly paramfieldProgram: WebGLProgram;

  constructor(opts: SimEngineOptions) {
    const gl = createGL2(opts.canvas);
    this.gl = gl;
    this.resolution = opts.resolution;
    this.state = new PingPongTarget(gl, opts.resolution, opts.resolution);
    this.velocity = new SingleTarget(gl, opts.resolution, opts.resolution);
    this.paramField = new SingleTarget(gl, opts.resolution, opts.resolution);
    this.seedProgram = createProgram(gl, FULLSCREEN_VERT, composeFragmentShader(commonGlsl, seedFrag));
    this.reactProgram = createProgram(gl, FULLSCREEN_VERT, composeFragmentShader(commonGlsl, reactFrag));
    this.displayProgram = createProgram(gl, FULLSCREEN_VERT, composeFragmentShader(commonGlsl, displayFrag));
    this.velocityProgram = createProgram(gl, FULLSCREEN_VERT, composeFragmentShader(commonGlsl, velocityFrag));
    this.advectProgram = createProgram(gl, FULLSCREEN_VERT, composeFragmentShader(commonGlsl, advectFrag));
    this.paramfieldProgram = createProgram(gl, FULLSCREEN_VERT, composeFragmentShader(commonGlsl, paramfieldFrag));
    this.reseed();
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

  /** Draws the current state to the canvas (default framebuffer). */
  render(palette: PaletteUniforms): void {
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
    }, null);
  }

  /** Changes the simulation grid resolution, preserving the current pattern. */
  setResolution(resolution: number): void {
    if (resolution === this.resolution) return;
    this.resolution = resolution;
    this.state.resize(resolution, resolution);
    this.velocity.resize(resolution, resolution);
    this.paramField.resize(resolution, resolution);
  }
}
