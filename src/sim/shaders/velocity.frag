// Velocity field for advection: curl noise (divergence-free) plus a constant
// drift ("gravity"). Recomputed once per rendered frame.
in vec2 vUv;
out vec4 fragColor;

uniform float uCurlStrength;
uniform float uCurlScale;
uniform vec2 uDrift;
uniform float uEvolveT;

void main() {
  vec2 p = vUv * uCurlScale + uEvolveT;
  vec2 vel = curlNoise(p, 0.05) * uCurlStrength + uDrift;
  fragColor = vec4(vel, 0.0, 1.0);
}
