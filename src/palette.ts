// Cosine palettes (Inigo Quilez's a + b·cos(2π(c·t+d))) — pure, no WebGL.
// The Palette card's shift/contrast/bands knobs are folded into the final
// coefficients by composePalette() so the shader just evaluates the formula.
export type Vec3 = readonly [number, number, number];

export interface CosinePalette {
  name: string;
  a: Vec3;
  b: Vec3;
  c: Vec3;
  d: Vec3;
}

// Order must match schema/visual.ts's PALETTE_NAMES (index = select value).
export const BUILTIN_PALETTES: readonly CosinePalette[] = [
  {
    name: 'Marble',
    a: [0.55, 0.5, 0.45], b: [0.45, 0.4, 0.35], c: [1.0, 1.0, 1.0], d: [0.0, 0.15, 0.3],
  },
  {
    name: 'Glaze',
    a: [0.5, 0.35, 0.4], b: [0.5, 0.4, 0.4], c: [1.2, 1.0, 0.9], d: [0.3, 0.2, 0.15],
  },
  {
    name: 'Verdigris',
    a: [0.35, 0.45, 0.42], b: [0.3, 0.35, 0.3], c: [1.0, 1.2, 1.0], d: [0.4, 0.5, 0.4],
  },
  {
    name: 'Ink',
    a: [0.2, 0.2, 0.22], b: [0.6, 0.6, 0.62], c: [1.0, 1.0, 1.0], d: [0.0, 0.05, 0.1],
  },
  {
    name: 'Basalt',
    a: [0.22, 0.22, 0.24], b: [0.18, 0.18, 0.2], c: [1.0, 1.0, 1.1], d: [0.05, 0.1, 0.15],
  },
];

export function palettesByIndex(index: number): CosinePalette {
  return BUILTIN_PALETTES[index] ?? BUILTIN_PALETTES[0];
}

export interface PaletteUniforms {
  a: Vec3;
  b: Vec3;
  c: Vec3;
  d: Vec3;
  bands: number;
  relief: number;
  lightAngle: number;
  gloss: number;
}

/** Folds the Palette card's shift/contrast/bands/relief/lightAngle/gloss onto a built-in palette. */
export function composePalette(
  base: CosinePalette,
  shift: number,
  contrast: number,
  bands: number,
  relief: number,
  lightAngle: number,
  gloss: number,
): PaletteUniforms {
  return {
    a: base.a,
    b: [base.b[0] * contrast, base.b[1] * contrast, base.b[2] * contrast],
    c: base.c,
    d: [base.d[0] + shift, base.d[1] + shift, base.d[2] + shift],
    bands,
    relief,
    lightAngle,
    gloss,
  };
}

/** 0xRRGGBB -> [0,1] RGB triple. */
export function hexToVec3(n: number): Vec3 {
  const clamped = Math.max(0, Math.min(0xffffff, Math.round(n)));
  return [
    ((clamped >> 16) & 0xff) / 255,
    ((clamped >> 8) & 0xff) / 255,
    (clamped & 0xff) / 255,
  ];
}
