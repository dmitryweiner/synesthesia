// Render targets for the simulation, swapped each substep for the
// reaction-diffusion state; resize() preserves content via blitFramebuffer.
//
// RG16F, not RGBA16F: every target here holds exactly two channels (state
// u/v, velocity x/y, paramfield feed/kill offsets) and the other two were
// dead weight — on a software rasterizer the reaction pass is bound by how
// much of the state texture it can pull through the cache, so halving the
// texture halves the pass.
import type { RenderTarget } from './quad';

function createFloatTarget(gl: WebGL2RenderingContext, width: number, height: number): [WebGLTexture, WebGLFramebuffer] {
  const tex = gl.createTexture();
  if (!tex) throw new Error('gl.createTexture failed.');
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RG16F, width, height, 0, gl.RG, gl.HALF_FLOAT, null);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

  const fbo = gl.createFramebuffer();
  if (!fbo) throw new Error('gl.createFramebuffer failed.');
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
  const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
  if (status !== gl.FRAMEBUFFER_COMPLETE) {
    throw new Error(`framebuffer incomplete: 0x${status.toString(16)}`);
  }
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.bindTexture(gl.TEXTURE_2D, null);
  return [tex, fbo];
}

function blit(
  gl: WebGL2RenderingContext,
  srcFbo: WebGLFramebuffer, srcW: number, srcH: number,
  dstFbo: WebGLFramebuffer, dstW: number, dstH: number,
): void {
  gl.bindFramebuffer(gl.READ_FRAMEBUFFER, srcFbo);
  gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, dstFbo);
  gl.blitFramebuffer(0, 0, srcW, srcH, 0, 0, dstW, dstH, gl.COLOR_BUFFER_BIT, gl.LINEAR);
  gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null);
  gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null);
}

/**
 * A 1x1 all-zero RG texture, bound in place of a pass that was skipped
 * because it would have written nothing but zeros (an off Field variation
 * card). The reader samples it exactly as it samples the real field.
 */
export function createZeroTexture(gl: WebGL2RenderingContext): WebGLTexture {
  const tex = gl.createTexture();
  if (!tex) throw new Error('gl.createTexture failed.');
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RG16F, 1, 1, 0, gl.RG, gl.FLOAT, new Float32Array([0, 0]));
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.bindTexture(gl.TEXTURE_2D, null);
  return tex;
}

export class PingPongTarget {
  width: number;
  height: number;

  private readonly gl: WebGL2RenderingContext;
  private texA: WebGLTexture;
  private texB: WebGLTexture;
  private fboA: WebGLFramebuffer;
  private fboB: WebGLFramebuffer;
  private frontIsA = true;

  constructor(gl: WebGL2RenderingContext, width: number, height: number) {
    this.gl = gl;
    this.width = width;
    this.height = height;
    const [texA, fboA] = createFloatTarget(gl, width, height);
    const [texB, fboB] = createFloatTarget(gl, width, height);
    this.texA = texA;
    this.fboA = fboA;
    this.texB = texB;
    this.fboB = fboB;
  }

  get readTexture(): WebGLTexture {
    return this.frontIsA ? this.texA : this.texB;
  }

  /** The framebuffer holding the current state (for a readback). */
  get readFramebuffer(): WebGLFramebuffer {
    return this.frontIsA ? this.fboA : this.fboB;
  }

  get writeTarget(): RenderTarget {
    return { fbo: this.frontIsA ? this.fboB : this.fboA, width: this.width, height: this.height };
  }

  swap(): void {
    this.frontIsA = !this.frontIsA;
  }

  /** Resizes both buffers, blitting the current state into each. */
  resize(width: number, height: number): void {
    if (width === this.width && height === this.height) return;
    const gl = this.gl;
    const oldReadFbo = this.frontIsA ? this.fboA : this.fboB;
    const [newTexA, newFboA] = createFloatTarget(gl, width, height);
    const [newTexB, newFboB] = createFloatTarget(gl, width, height);
    blit(gl, oldReadFbo, this.width, this.height, newFboA, width, height);
    blit(gl, oldReadFbo, this.width, this.height, newFboB, width, height);
    gl.deleteTexture(this.texA);
    gl.deleteTexture(this.texB);
    gl.deleteFramebuffer(this.fboA);
    gl.deleteFramebuffer(this.fboB);
    this.texA = newTexA;
    this.fboA = newFboA;
    this.texB = newTexB;
    this.fboB = newFboB;
    this.frontIsA = true;
    this.width = width;
    this.height = height;
  }
}

/** A single float texture + FBO for passes recomputed from scratch every frame. */
export class SingleTarget {
  width: number;
  height: number;

  private readonly gl: WebGL2RenderingContext;
  private tex: WebGLTexture;
  private fbo: WebGLFramebuffer;

  constructor(gl: WebGL2RenderingContext, width: number, height: number) {
    this.gl = gl;
    this.width = width;
    this.height = height;
    const [tex, fbo] = createFloatTarget(gl, width, height);
    this.tex = tex;
    this.fbo = fbo;
  }

  get texture(): WebGLTexture {
    return this.tex;
  }

  get target(): RenderTarget {
    return { fbo: this.fbo, width: this.width, height: this.height };
  }

  resize(width: number, height: number): void {
    if (width === this.width && height === this.height) return;
    const gl = this.gl;
    const [newTex, newFbo] = createFloatTarget(gl, width, height);
    gl.deleteTexture(this.tex);
    gl.deleteFramebuffer(this.fbo);
    this.tex = newTex;
    this.fbo = newFbo;
    this.width = width;
    this.height = height;
  }
}
