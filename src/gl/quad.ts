// Fullscreen-triangle rendering: every pass draws one oversized triangle
// (position from gl_VertexID, no vertex buffers), plus a typed-uniform helper.

export const FULLSCREEN_VERT = `#version 300 es
out vec2 vUv;
void main() {
  vec2 pos = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2);
  vUv = pos;
  gl_Position = vec4(pos * 2.0 - 1.0, 0.0, 1.0);
}
`;

export type UniformValue =
  | { type: '1f'; value: number }
  | { type: '2f'; value: readonly [number, number] }
  | { type: '3f'; value: readonly [number, number, number] }
  | { type: '1i'; value: number }
  | { type: '2fv'; value: Float32Array }
  | { type: 'tex'; value: WebGLTexture; unit: number };

export type Uniforms = Record<string, UniformValue>;

export function u1f(value: number): UniformValue { return { type: '1f', value }; }
export function u2f(x: number, y: number): UniformValue { return { type: '2f', value: [x, y] }; }
export function u3f(x: number, y: number, z: number): UniformValue { return { type: '3f', value: [x, y, z] }; }
export function u1i(value: number): UniformValue { return { type: '1i', value }; }
export function u2fv(value: Float32Array): UniformValue { return { type: '2fv', value }; }
export function utex(value: WebGLTexture, unit: number): UniformValue { return { type: 'tex', value, unit }; }

function applyUniforms(gl: WebGL2RenderingContext, program: WebGLProgram, uniforms: Uniforms): void {
  for (const [name, u] of Object.entries(uniforms)) {
    const loc = gl.getUniformLocation(program, name);
    if (!loc) continue; // optimized out by the compiler — not an error
    switch (u.type) {
      case '1f': gl.uniform1f(loc, u.value); break;
      case '2f': gl.uniform2f(loc, u.value[0], u.value[1]); break;
      case '3f': gl.uniform3f(loc, u.value[0], u.value[1], u.value[2]); break;
      case '1i': gl.uniform1i(loc, u.value); break;
      case '2fv': gl.uniform2fv(loc, u.value); break;
      case 'tex':
        gl.activeTexture(gl.TEXTURE0 + u.unit);
        gl.bindTexture(gl.TEXTURE_2D, u.value);
        gl.uniform1i(loc, u.unit);
        break;
    }
  }
}

export interface RenderTarget {
  fbo: WebGLFramebuffer;
  width: number;
  height: number;
}

/** Runs one full-canvas pass of `program` into `target` (null = canvas). */
export function runPass(
  gl: WebGL2RenderingContext,
  program: WebGLProgram,
  uniforms: Uniforms,
  target: RenderTarget | null,
): void {
  gl.bindFramebuffer(gl.FRAMEBUFFER, target ? target.fbo : null);
  gl.viewport(0, 0, target ? target.width : gl.drawingBufferWidth, target ? target.height : gl.drawingBufferHeight);
  gl.useProgram(program);
  applyUniforms(gl, program, uniforms);
  gl.drawArrays(gl.TRIANGLES, 0, 3);
}
