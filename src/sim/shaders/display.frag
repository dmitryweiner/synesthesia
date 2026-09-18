// Field -> color: an iq-style cosine gradient (a/b/c/d already carry the
// Palette card's shift/contrast — see src/palette.ts composePalette), plus a
// bump-mapped relief pass that makes a flat gradient lookup read as "stone"
// or "wet glaze" rather than a heatmap.
in vec2 vUv;
out vec4 fragColor;

uniform sampler2D uState;
uniform vec2 uTexel;
uniform vec3 uPalA;
uniform vec3 uPalB;
uniform vec3 uPalC;
uniform vec3 uPalD;
uniform float uBands;
uniform float uRelief;
uniform float uLightAngle;
uniform float uGloss;

vec3 cosinePalette(float t, vec3 a, vec3 b, vec3 c, vec3 d) {
  return a + b * cos(6.28318 * (c * t + d));
}

float heightAt(vec2 uv) {
  return texture(uState, uv).g;
}

void main() {
  vec4 s = texture(uState, vUv);
  float raw = clamp(s.g * 1.6, 0.0, 1.0);
  float t = fract(raw * uBands);
  vec3 col = cosinePalette(t, uPalA, uPalB, uPalC, uPalD);

  float hL = heightAt(vUv - vec2(uTexel.x, 0.0));
  float hR = heightAt(vUv + vec2(uTexel.x, 0.0));
  float hD = heightAt(vUv - vec2(0.0, uTexel.y));
  float hU = heightAt(vUv + vec2(0.0, uTexel.y));
  vec3 normal = normalize(vec3((hL - hR) * uRelief, (hD - hU) * uRelief, 1.0));

  vec3 lightDir = normalize(vec3(cos(uLightAngle), sin(uLightAngle), 0.6));
  float diffuse = max(dot(normal, lightDir), 0.0);
  vec3 reflectDir = reflect(-lightDir, normal);
  float specular = pow(max(reflectDir.z, 0.0), 24.0) * uGloss;

  col *= 0.55 + 0.55 * diffuse;
  col += specular;

  fragColor = vec4(col, 1.0);
}
