// One Gray-Scott substep. State texture: R = u, G = v. Boundary is
// effectively zero-flux since the state texture clamps to edge. feed/kill
// are perturbed per-pixel by the Field variation paramfield texture (all
// zero when that card is off — a no-op).
in vec2 vUv;
out vec4 fragColor;

uniform sampler2D uState;
uniform sampler2D uParamField;
uniform vec2 uTexel;
uniform float uFeed;
uniform float uKill;
uniform float uDiffU;
uniform float uDiffV;
uniform float uDt;

// 9-point weighted Laplacian (more isotropic than the plain 5-point stencil).
vec2 laplacian(vec2 uv) {
  vec2 sum = vec2(0.0);
  sum += texture(uState, uv + uTexel * vec2(-1.0, -1.0)).rg * 0.05;
  sum += texture(uState, uv + uTexel * vec2(0.0, -1.0)).rg * 0.2;
  sum += texture(uState, uv + uTexel * vec2(1.0, -1.0)).rg * 0.05;
  sum += texture(uState, uv + uTexel * vec2(-1.0, 0.0)).rg * 0.2;
  sum += texture(uState, uv).rg * -1.0;
  sum += texture(uState, uv + uTexel * vec2(1.0, 0.0)).rg * 0.2;
  sum += texture(uState, uv + uTexel * vec2(-1.0, 1.0)).rg * 0.05;
  sum += texture(uState, uv + uTexel * vec2(0.0, 1.0)).rg * 0.2;
  sum += texture(uState, uv + uTexel * vec2(1.0, 1.0)).rg * 0.05;
  return sum;
}

void main() {
  vec4 here = texture(uState, vUv);
  float u = here.r;
  float v = here.g;
  vec2 lap = laplacian(vUv);
  vec2 fieldOffset = texture(uParamField, vUv).rg;
  float feed = clamp(uFeed + fieldOffset.r, 0.0, 1.0);
  float kill = clamp(uKill + fieldOffset.g, 0.0, 1.0);
  float reaction = u * v * v;
  float du = uDiffU * lap.r - reaction + feed * (1.0 - u);
  float dv = uDiffV * lap.g + reaction - (feed + kill) * v;
  float nu = clamp(u + du * uDt, 0.0, 1.0);
  float nv = clamp(v + dv * uDt, 0.0, 1.0);
  fragColor = vec4(nu, nv, here.ba);
}
