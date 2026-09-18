// WebGL2 context creation + shader compilation with readable error messages.
// No runtime deps — everything downstream talks to the raw context.

export function createGL2(canvas: HTMLCanvasElement): WebGL2RenderingContext {
  const gl = canvas.getContext('webgl2', { antialias: false, alpha: false, preserveDrawingBuffer: true });
  if (!gl) throw new Error('WebGL2 unavailable.');
  if (!gl.getExtension('EXT_color_buffer_float')) {
    throw new Error('EXT_color_buffer_float unavailable — cannot render to float targets.');
  }
  return gl;
}

function annotateSource(source: string): string {
  return source.split('\n').map((line, i) => `${i + 1}: ${line}`).join('\n');
}

function compileShader(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader {
  const shader = gl.createShader(type);
  if (!shader) throw new Error('gl.createShader failed.');
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader) ?? 'unknown error';
    gl.deleteShader(shader);
    const kind = type === gl.VERTEX_SHADER ? 'vertex' : 'fragment';
    throw new Error(`${kind} shader compile error:\n${log}\n${annotateSource(source)}`);
  }
  return shader;
}

export function createProgram(gl: WebGL2RenderingContext, vertSrc: string, fragSrc: string): WebGLProgram {
  const vert = compileShader(gl, gl.VERTEX_SHADER, vertSrc);
  const frag = compileShader(gl, gl.FRAGMENT_SHADER, fragSrc);
  const program = gl.createProgram();
  if (!program) throw new Error('gl.createProgram failed.');
  gl.attachShader(program, vert);
  gl.attachShader(program, frag);
  gl.linkProgram(program);
  gl.deleteShader(vert);
  gl.deleteShader(frag);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(program) ?? 'unknown error';
    gl.deleteProgram(program);
    throw new Error(`program link error:\n${log}`);
  }
  return program;
}

/**
 * Fragment sources are written WITHOUT `#version`/`precision` pragmas so they
 * can be concatenated: common.glsl (helpers) followed by the pass body.
 */
export function composeFragmentShader(...sources: string[]): string {
  return ['#version 300 es', 'precision highp float;', ...sources].join('\n');
}
