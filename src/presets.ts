// Built-in presets: curated audio + image pairings. The audio halves come
// from formula-synth's presets and the image halves from chromaflux's —
// both were tuned by ear/eye and liked by people, so they are the seeds
// every exploration starts from. What's new here is the pairing: the LFO
// pool is shared, so one slow LFO drives both a synth parameter and an
// image parameter, and the coupling block lets loudness/timbre/onsets push
// the picture around live.
import type { Params } from './dsp/generator';
import type { LfoDef, ModRoute } from './dsp/mod';
import type { FxState } from './schema/audio';
import type { AppState, CouplingState } from './state/schema';
import { LFO_COUNT, DEFAULT_LFO, stateToAppState } from './state/schema';

export interface Preset {
  name: string;
  state: AppState;
}

interface PresetSpec {
  masterGain?: number;
  fx?: Partial<FxState>;
  /** Enabled formulas with their param overrides (UI defaults fill the rest). */
  formulas: Record<string, Params>;
  reaction?: Record<string, number>;
  fieldVariation?: Record<string, number>;
  flow?: Record<string, number>;
  palette?: Record<string, number>;
  lfos?: LfoDef[];
  routes?: ModRoute[];
  coupling?: Partial<CouplingState>;
}

// Setting fieldVariation/flow turns the card on (a preset wouldn't list
// params for a card it doesn't want).
function preset(name: string, spec: PresetSpec): Preset {
  const formulas: Record<string, { enabled: boolean; params: Params }> = {};
  for (const [id, params] of Object.entries(spec.formulas)) formulas[id] = { enabled: true, params };
  const cards: Record<string, { on?: boolean; params?: Record<string, number> }> = {};
  if (spec.reaction) cards.reaction = { params: spec.reaction };
  if (spec.fieldVariation) cards.fieldVariation = { on: true, params: spec.fieldVariation };
  if (spec.flow) cards.flow = { on: true, params: spec.flow };
  if (spec.palette) cards.palette = { params: spec.palette };
  const lfos: LfoDef[] = [];
  for (let i = 0; i < LFO_COUNT; i++) lfos.push({ ...(spec.lfos?.[i] ?? DEFAULT_LFO) });
  const state = stateToAppState({
    presetName: name,
    audio: { masterGain: spec.masterGain ?? 0.75, fx: spec.fx ?? {}, formulas },
    visual: { cards },
    mod: { lfos, routes: (spec.routes ?? []).map((r) => ({ ...r })) },
    coupling: spec.coupling ?? {},
  });
  return { name, state };
}

const LIMITED: Partial<FxState> = { limiterOn: true, limiterThr: -12, limiterRel: 0.15 };

export const PRESETS: readonly Preset[] = [
  preset('Fractal garden', {
    // Audio: formula-synth's "Fractal garden" — grown by iterating on the
    // spectrogram; the logistic map's r is swept through chaos and periodic
    // windows by a ~77 s triangle. Image: chromaflux's "Shapeshifter" —
    // Feed swept across the Pearson map so the pattern family itself morphs.
    // The SAME triangle (LFO 2) drives both r and Feed: bifurcation cascades
    // in the sound coincide with spots→coral→maze in the picture.
    masterGain: 0.72,
    fx: {
      ...LIMITED,
      filterOn: true, filterType: 'comb', filterFreq: 220, filterCombFb: 0.7,
      chorusOn: true, chorusMode: 'chorus', chorusRate: 0.07, chorusDepth: 7, chorusMix: 0.25, chorusFb: 0.25,
      phaserOn: true, phaserRate: 0.25, phaserDepth: 0.7, phaserStages: 8, phaserFb: 0.5, phaserMix: 0.45,
      delayOn: true, delayTime: 0.66, delayFb: 0.5, delayMix: 0.3,
      reverbOn: true, reverbDecay: 5.5, reverbMix: 0.25,
    },
    formulas: {
      additive: { gain: 0.45, fund: 55, N: 24, move: 0.25 },
      beats: { gain: 0.28, fbeat: 55, df: 0.6 },
      logistic: { gain: 0.12, base: 330, depth: 500, r: 3.68, lfoHz: 16 },
      fm: { gain: 0.15, fc: 880, fm: 55, I: 5 },
      shepard: { gain: 0.1, shepBase: 55, shepSpeed: 0.05, shepOctaves: 8 },
    },
    reaction: { feed: 0.041, kill: 0.061, speed: 16 },
    fieldVariation: { feedVarAmount: 0.006, feedVarScale: 4, feedVarWarp: 0.9, killVarAmount: 0.003, killVarScale: 5, killVarWarp: 0.8 },
    flow: { curlStrength: 0.006, curlScale: 3, advectAmount: 0.18, evolveRate: 0.005 },
    palette: { paletteId: 0, contrast: 1.15, relief: 1.0, gloss: 0.3 },
    lfos: [
      { shape: 'sine', rate: 0.023, phase: 0 },
      { shape: 'triangle', rate: 0.013, phase: 0.25 },
      { shape: 'sine', rate: 0.089, phase: 0 },
      { shape: 'random', rate: 0.031, phase: 0 },
    ],
    routes: [
      { src: 0, target: 'fx', param: 'filterFreq', depth: 0.3, exp: true },
      { src: 0, target: 'fx', param: 'reverbMix', depth: 0.25 },
      { src: 1, target: 'logistic', param: 'r', depth: 0.15 },
      { src: 1, target: 'logistic', param: 'lfoHz', depth: 0.2, exp: true },
      { src: 1, target: 'shepard', param: 'gain', depth: 0.1 },
      { src: 2, target: 'fm', param: 'I', depth: 0.35 },
      { src: 2, target: 'fx', param: 'chorusDepth', depth: 0.3 },
      { src: 3, target: 'logistic', param: 'base', depth: 0.1, exp: true },
      { src: 3, target: 'shepard', param: 'shepSpeed', depth: 0.12 },
      { src: 3, target: 'fx', param: 'delayFb', depth: 0.2 },
      { src: 1, target: 'reaction', param: 'feed', depth: 0.22 },
      { src: 2, target: 'flow', param: 'curlStrength', depth: 0.3 },
    ],
    coupling: { loudToGloss: 0.5, brightToShift: 0.4, onsetToLight: 0.3, loudToPulse: 0.7, onsetToFlash: 0.4, onsetToSeed: 0.5, spectrumToTint: 0.6 },
  }),

  preset('Stillness ink', {
    // "Stillness meditation" (additive + Rössler through a resonant LP and
    // slow chorus) over "Ink wash" (stripes/maze in the Ink palette). No LFO
    // on the sound — the picture breathes instead: light slowly circles.
    fx: {
      ...LIMITED,
      filterOn: true, filterType: 'lowpass', filterFreq: 2000, filterQ: 6.3,
      chorusOn: true, chorusMode: 'chorus', chorusRate: 0.01, chorusDepth: 8.4, chorusMix: 0.35, chorusFb: 0.95,
      reverbOn: true, reverbDecay: 3.2, reverbMix: 0.5,
      delayOn: true, delayTime: 0.63, delayFb: 0.62, delayMix: 0.3,
      phaserOn: true, phaserRate: 0.47, phaserDepth: 0.59, phaserStages: 4, phaserFb: 0.62, phaserMix: 0.22,
    },
    formulas: {
      additive: { gain: 0.474, fund: 57, N: 12, move: 0.35 },
      rossler: { gain: 0.169, rossA: 0.181, rossB: 0.238, rossC: 6.42, rossBase: 345, rossFreqScale: 38.4, rossAmp: 0.25 },
    },
    reaction: { feed: 0.03, kill: 0.057 },
    fieldVariation: { feedVarAmount: 0.015, feedVarScale: 3, feedVarWarp: 1.6, killVarAmount: 0.008, killVarScale: 4, killVarWarp: 1.4 },
    flow: { curlStrength: 0.004, curlScale: 3, advectAmount: 0.2, evolveRate: 0.006 },
    palette: { paletteId: 3, bands: 2, contrast: 1.2 },
    lfos: [{ shape: 'saw', rate: 0.01, phase: 0 }, { shape: 'sine', rate: 0.03, phase: 0 }],
    routes: [
      { src: 0, target: 'palette', param: 'lightAngle', depth: 0.5 },
      { src: 1, target: 'palette', param: 'gloss', depth: 0.2 },
    ],
    coupling: { loudToGloss: 0.4, brightToShift: 0.3, loudToPulse: 0.8, onsetToFlash: 0.2, onsetToSeed: 0.3, spectrumToTint: 0.7 },
  }),

  preset('Whale coral', {
    // "Whale talks": FM whose pitch drifts in octaves and whose index
    // breathes. "Living coral": coral growth under gentle flow. LFO 1 (the
    // pitch drift) also slides the palette hue; loudness pushes the flow.
    fx: {
      ...LIMITED,
      filterOn: true, filterType: 'lowpass', filterFreq: 1400, filterQ: 0.8,
      reverbOn: true, reverbDecay: 3.6, reverbMix: 0.42,
    },
    formulas: { fm: { gain: 0.18, fc: 220, fm: 2, I: 4 } },
    reaction: { feed: 0.0545, kill: 0.062 },
    fieldVariation: { feedVarAmount: 0.008, feedVarScale: 5, feedVarWarp: 0.8, killVarAmount: 0.004, killVarScale: 6, killVarWarp: 0.8 },
    flow: { curlStrength: 0.006, curlScale: 4, advectAmount: 0.25, evolveRate: 0.01 },
    palette: { paletteId: 1, contrast: 1.1 },
    lfos: [
      { shape: 'sine', rate: 0.05, phase: 0 },
      { shape: 'sine', rate: 0.13, phase: 0.25 },
      { shape: 'triangle', rate: 0.08, phase: 0 },
    ],
    routes: [
      { src: 0, target: 'fm', param: 'fc', depth: 0.15, exp: true },
      { src: 1, target: 'fm', param: 'I', depth: 0.6 },
      { src: 0, target: 'palette', param: 'shift', depth: 0.2 },
      { src: 2, target: 'palette', param: 'lightAngle', depth: 0.3 },
    ],
    coupling: { loudToFlow: 0.6, brightToShift: 0.5, loudToGloss: 0.4, loudToPulse: 0.7, onsetToFlash: 0.3, onsetToSeed: 0.4, spectrumToTint: 0.8 },
  }),

  preset('Molten Polivoks', {
    // "Polivoks drone": fat saw drone + detuned pair + tanh growl, resonant
    // LP swept by mutually irrational LFOs. "Molten glass": a glaze that
    // sags in a slowly rotating direction. Two of the drone's LFOs drive
    // Drift X/Y (different rates → Lissajous-like wandering), the triangle
    // that breathes the filter resonance also swings the light.
    masterGain: 0.72,
    fx: {
      ...LIMITED,
      filterOn: true, filterType: 'lowpass', filterFreq: 300, filterQ: 8,
      chorusOn: true, chorusMode: 'chorus', chorusRate: 0.05, chorusDepth: 12, chorusMix: 0.5, chorusFb: 0.35,
      delayOn: true, delayTime: 1.3, delayFb: 0.5, delayMix: 0.35,
      reverbOn: true, reverbDecay: 6.5, reverbMix: 0.4,
    },
    formulas: {
      additive: { gain: 0.5, fund: 55, N: 30, move: 0.12 },
      beats: { gain: 0.3, fbeat: 55, df: 0.7 },
      dist: { gain: 0.14, fd: 110, alpha: 4 },
      brownnoise: { gain: 0.05, brownStep: 0.008 },
    },
    reaction: { feed: 0.032, kill: 0.058, speed: 20 },
    fieldVariation: { feedVarAmount: 0.018, feedVarScale: 3, feedVarWarp: 1.5, killVarAmount: 0.009, killVarScale: 4, killVarWarp: 1.2 },
    flow: { curlStrength: 0.012, curlScale: 2, advectAmount: 0.3, evolveRate: 0.006 },
    palette: { paletteId: 1, contrast: 1.15, relief: 1.3, gloss: 0.55, shift: 0.05, lightAngle: 3.1415 },
    lfos: [
      { shape: 'sine', rate: 0.019, phase: 0 },
      { shape: 'triangle', rate: 0.031, phase: 0.5 },
      { shape: 'sine', rate: 0.047, phase: 0.25 },
      { shape: 'random', rate: 0.029, phase: 0 },
    ],
    routes: [
      { src: 0, target: 'fx', param: 'filterFreq', depth: 0.32, exp: true },
      { src: 1, target: 'fx', param: 'filterQ', depth: 0.5 },
      { src: 1, target: 'beats', param: 'df', depth: 0.05 },
      { src: 2, target: 'fx', param: 'chorusDepth', depth: 0.4 },
      { src: 2, target: 'fx', param: 'reverbMix', depth: 0.35 },
      { src: 2, target: 'dist', param: 'fd', depth: 0.05, exp: true },
      { src: 3, target: 'dist', param: 'alpha', depth: 0.3 },
      { src: 3, target: 'additive', param: 'move', depth: 0.08 },
      { src: 3, target: 'fx', param: 'delayFb', depth: 0.2 },
      { src: 0, target: 'flow', param: 'driftX', depth: 0.25 },
      { src: 2, target: 'flow', param: 'driftY', depth: 0.25 },
      { src: 1, target: 'palette', param: 'lightAngle', depth: 0.5 },
    ],
    coupling: { loudToGloss: 0.6, loudToCurl: 0.5, loudToPulse: 0.8, onsetToFlash: 0.3, onsetToSeed: 0.3, spectrumToTint: 0.9 },
  }),

  preset('Aurora', {
    // "Aurora pad" (lush additive pad, pitch/animation/harmonics breathing)
    // over "Aurora glaze" (Verdigris bands whose hue and light drift). The
    // pad's LFOs are the ones that shimmer the color.
    fx: {
      ...LIMITED,
      filterOn: true, filterType: 'lowpass', filterFreq: 1800, filterQ: 0.7,
      chorusOn: true, chorusMode: 'chorus', chorusRate: 0.08, chorusDepth: 8, chorusMix: 0.4, chorusFb: 0.3,
      reverbOn: true, reverbDecay: 4.5, reverbMix: 0.48,
    },
    formulas: { additive: { gain: 0.75, fund: 82, N: 16, move: 0.3 } },
    reaction: { feed: 0.029, kill: 0.057, speed: 12 },
    fieldVariation: { feedVarAmount: 0.012, feedVarScale: 3, feedVarWarp: 1.4, killVarAmount: 0.006, killVarScale: 4, killVarWarp: 1.2 },
    flow: { curlStrength: 0.007, curlScale: 4.5, advectAmount: 0.22, evolveRate: 0.014 },
    palette: { paletteId: 2, bands: 3, contrast: 1.3, relief: 1.0, gloss: 0.45, shift: 0.5, lightAngle: 3.1415 },
    lfos: [
      { shape: 'sine', rate: 0.04, phase: 0 },
      { shape: 'sine', rate: 0.11, phase: 0.3 },
      { shape: 'triangle', rate: 0.07, phase: 0 },
      { shape: 'saw', rate: 0.012, phase: 0 },
    ],
    routes: [
      { src: 0, target: 'additive', param: 'fund', depth: 0.12, exp: true },
      { src: 1, target: 'additive', param: 'move', depth: 0.5 },
      { src: 2, target: 'additive', param: 'N', depth: 0.3 },
      { src: 3, target: 'palette', param: 'shift', depth: 0.5 },
      { src: 0, target: 'palette', param: 'lightAngle', depth: 0.5 },
      { src: 2, target: 'palette', param: 'gloss', depth: 0.25 },
      { src: 1, target: 'flow', param: 'curlStrength', depth: 0.2 },
    ],
    coupling: { brightToShift: 0.4, loudToGloss: 0.4, loudToPulse: 0.6, onsetToFlash: 0.2, onsetToSeed: 0.3, spectrumToTint: 0.8 },
  }),

  preset('Silver maze', {
    // "Silver lace" (woven harmonic lace on a 110 Hz grid, peaking glow
    // wandering the upper mids) over "Fine maze" (Ink, two bands). The glow
    // LFO also shifts the hue; the fan-index triangle wobbles Kill so the
    // maze thickens and thins with the lace.
    masterGain: 0.72,
    fx: {
      ...LIMITED,
      filterOn: true, filterType: 'peaking', filterFreq: 1400, filterQ: 2, filterGain: 6,
      chorusOn: true, chorusMode: 'chorus', chorusRate: 0.08, chorusDepth: 6, chorusMix: 0.35, chorusFb: 0.25,
      phaserOn: true, phaserRate: 0.18, phaserDepth: 0.55, phaserStages: 6, phaserFb: 0.3, phaserMix: 0.35,
      delayOn: true, delayTime: 0.55, delayFb: 0.35, delayMix: 0.25,
      reverbOn: true, reverbDecay: 5, reverbMix: 0.45,
    },
    formulas: {
      additive: { gain: 0.58, fund: 110, N: 22, move: 0.3 },
      beats: { gain: 0.3, fbeat: 110, df: 0.8 },
      fm: { gain: 0.16, fc: 880, fm: 55, I: 4 },
      quasi: { gain: 0.12, fq: 440, Aq: 60, wq: 0.4 },
    },
    reaction: { feed: 0.029, kill: 0.057 },
    palette: { paletteId: 3, bands: 2 },
    lfos: [
      { shape: 'sine', rate: 0.021, phase: 0 },
      { shape: 'triangle', rate: 0.037, phase: 0.5 },
      { shape: 'sine', rate: 0.053, phase: 0.25 },
      { shape: 'random', rate: 0.033, phase: 0 },
    ],
    routes: [
      { src: 0, target: 'fx', param: 'filterFreq', depth: 0.35, exp: true },
      { src: 0, target: 'fx', param: 'reverbMix', depth: 0.25 },
      { src: 1, target: 'fm', param: 'I', depth: 0.3 },
      { src: 1, target: 'quasi', param: 'Aq', depth: 0.05 },
      { src: 2, target: 'fx', param: 'phaserRate', depth: 0.4, exp: true },
      { src: 2, target: 'fx', param: 'chorusDepth', depth: 0.3 },
      { src: 3, target: 'quasi', param: 'wq', depth: 0.1 },
      { src: 3, target: 'fx', param: 'delayFb', depth: 0.15 },
      { src: 0, target: 'palette', param: 'shift', depth: 0.15 },
      { src: 1, target: 'reaction', param: 'kill', depth: 0.05 },
    ],
    coupling: { loudToGloss: 0.5, onsetToLight: 0.4, loudToPulse: 0.6, onsetToFlash: 0.5, onsetToSeed: 0.4, spectrumToTint: 0.6 },
  }),

  preset('Space breccia', {
    // "Space journey" (Shepard climb over a low drone, whole FX chain
    // breathing) over "Breccia marble" (densely folded stripe layers). The
    // delay-time triangle also pulls Drift Y — the marble "falls" as the
    // echo pitches; loudness surges the flow.
    masterGain: 0.72,
    fx: {
      ...LIMITED,
      filterOn: true, filterType: 'lowpass', filterFreq: 420, filterQ: 5,
      chorusOn: true, chorusMode: 'chorus', chorusRate: 0.12, chorusDepth: 9, chorusMix: 0.4, chorusFb: 0.3,
      phaserOn: true, phaserRate: 0.3, phaserDepth: 0.75, phaserStages: 8, phaserFb: 0.55, phaserMix: 0.55,
      delayOn: true, delayTime: 0.6, delayFb: 0.45, delayMix: 0.4,
      reverbOn: true, reverbDecay: 6.5, reverbMix: 0.45,
    },
    formulas: {
      additive: { gain: 0.55, fund: 44, N: 24, move: 0.6 },
      shepard: { gain: 0.22, shepBase: 40, shepSpeed: 0.06, shepOctaves: 7 },
      fm: { gain: 0.16, fc: 110, fm: 1.5, I: 8 },
    },
    reaction: { feed: 0.032, kill: 0.058, speed: 18 },
    fieldVariation: { feedVarAmount: 0.022, feedVarScale: 3, feedVarWarp: 1.6, killVarAmount: 0.011, killVarScale: 4, killVarWarp: 1.3 },
    flow: { curlStrength: 0.015, curlScale: 2, driftY: 0.002, advectAmount: 0.3, evolveRate: 0.008 },
    palette: { paletteId: 0 },
    lfos: [
      { shape: 'sine', rate: 0.05, phase: 0 },
      { shape: 'triangle', rate: 0.037, phase: 0.5 },
      { shape: 'sine', rate: 0.11, phase: 0.25 },
      { shape: 'random', rate: 0.08, phase: 0 },
    ],
    routes: [
      { src: 0, target: 'fx', param: 'filterFreq', depth: 0.33, exp: true },
      { src: 0, target: 'fx', param: 'chorusDepth', depth: 0.4 },
      { src: 1, target: 'fx', param: 'delayTime', depth: 0.4, exp: true },
      { src: 2, target: 'fx', param: 'phaserRate', depth: 0.6, exp: true },
      { src: 2, target: 'fx', param: 'reverbMix', depth: 0.35 },
      { src: 3, target: 'fx', param: 'filterQ', depth: 0.5 },
      { src: 3, target: 'fx', param: 'delayFb', depth: 0.25 },
      { src: 1, target: 'flow', param: 'driftY', depth: 0.3 },
      { src: 0, target: 'palette', param: 'lightAngle', depth: 0.4 },
    ],
    coupling: { loudToFlow: 0.7, brightToShift: 0.4, loudToPulse: 0.8, onsetToFlash: 0.3, onsetToSeed: 0.3, spectrumToTint: 0.7 },
  }),

  preset('Cave coral', {
    // "Cave drips" (sparse resonant plinks in a long reverb) over "Coral
    // growth". Each drop flashes the light and glints the gloss; the slow
    // density LFO nudges Feed so growth surges with the rain.
    fx: {
      ...LIMITED,
      filterOn: true, filterType: 'lowpass', filterFreq: 2000, filterQ: 0.7,
      reverbOn: true, reverbDecay: 5, reverbMix: 0.55,
      delayOn: true, delayTime: 0.5, delayFb: 0.4, delayMix: 0.3,
    },
    formulas: { rain: { gain: 0.4, rainDensity: 3, rainPitch: 1100, rainBed: 0.1 } },
    reaction: { feed: 0.0545, kill: 0.062 },
    palette: { paletteId: 1, gloss: 0.35, relief: 1.1 },
    lfos: [
      { shape: 'sine', rate: 0.05, phase: 0 },
      { shape: 'triangle', rate: 0.03, phase: 0 },
      { shape: 'sine', rate: 0.09, phase: 0.4 },
    ],
    routes: [
      { src: 0, target: 'rain', param: 'rainDensity', depth: 0.3 },
      { src: 1, target: 'rain', param: 'rainPitch', depth: 0.3, exp: true },
      { src: 0, target: 'reaction', param: 'feed', depth: 0.1 },
    ],
    coupling: { onsetToLight: 0.8, loudToGloss: 0.6, loudToPulse: 0.4, onsetToFlash: 0.9, onsetToSeed: 1, spectrumToTint: 0.5 },
  }),

  preset('Loom & copper', {
    // "Harmonic loom" (FM fans, a moving comb, Shepard grid that flips
    // direction) over "Copper drip" (worms-family glaze dripping down).
    // The fan-center sine also slides the hue.
    masterGain: 0.72,
    fx: {
      ...LIMITED,
      filterOn: true, filterType: 'comb', filterFreq: 220, filterCombFb: 0.65,
      chorusOn: true, chorusMode: 'chorus', chorusRate: 0.06, chorusDepth: 8, chorusMix: 0.4, chorusFb: 0.3,
      phaserOn: true, phaserRate: 0.12, phaserDepth: 0.65, phaserStages: 8, phaserFb: 0.45, phaserMix: 0.45,
      delayOn: true, delayTime: 0.8, delayFb: 0.4, delayMix: 0.25,
      reverbOn: true, reverbDecay: 5.5, reverbMix: 0.35,
    },
    formulas: {
      additive: { gain: 0.65, fund: 55, N: 28, move: 0.2 },
      beats: { gain: 0.4, fbeat: 55, df: 0.6 },
      fm: { gain: 0.16, fc: 440, fm: 55, I: 6 },
      shepard: { gain: 0.09, shepBase: 60, shepSpeed: 0.03, shepOctaves: 7 },
    },
    reaction: { feed: 0.062, kill: 0.061, speed: 24 },
    fieldVariation: { feedVarAmount: 0.014, feedVarScale: 3, feedVarWarp: 1.4, killVarAmount: 0.007, killVarScale: 4, killVarWarp: 1.1 },
    flow: { curlStrength: 0.008, curlScale: 2.5, driftY: 0.008, advectAmount: 0.16, evolveRate: 0.005 },
    palette: { paletteId: 1, shift: 0.08, contrast: 1.2 },
    lfos: [
      { shape: 'sine', rate: 0.017, phase: 0 },
      { shape: 'triangle', rate: 0.043, phase: 0.5 },
      { shape: 'sine', rate: 0.061, phase: 0.25 },
      { shape: 'random', rate: 0.027, phase: 0 },
    ],
    routes: [
      { src: 0, target: 'fx', param: 'filterFreq', depth: 0.22, exp: true },
      { src: 0, target: 'fx', param: 'reverbMix', depth: 0.25 },
      { src: 1, target: 'fm', param: 'I', depth: 0.35 },
      { src: 1, target: 'fx', param: 'filterCombFb', depth: 0.15 },
      { src: 2, target: 'fm', param: 'fc', depth: 0.08, exp: true },
      { src: 2, target: 'fx', param: 'chorusDepth', depth: 0.35 },
      { src: 3, target: 'shepard', param: 'shepSpeed', depth: 0.1 },
      { src: 3, target: 'additive', param: 'move', depth: 0.08 },
      { src: 3, target: 'fx', param: 'delayFb', depth: 0.2 },
      { src: 2, target: 'palette', param: 'shift', depth: 0.2 },
    ],
    coupling: { loudToCurl: 0.6, loudToGloss: 0.4, loudToPulse: 0.6, onsetToFlash: 0.4, onsetToSeed: 0.4, spectrumToTint: 0.7 },
  }),

  preset('Wind ash', {
    // "Wind flanger" (ocean noise through a slow flanger) over "Ash glaze".
    // The sound has no LFO of its own (the ocean already breathes), so here
    // the picture listens: loudness drives the flow and curl, brightness
    // tints, and two slow LFOs keep the light and the curl alive.
    fx: {
      ...LIMITED,
      filterOn: true, filterType: 'lowpass', filterFreq: 1200, filterQ: 0.7,
      chorusOn: true, chorusMode: 'flanger', chorusRate: 0.08, chorusDepth: 6, chorusMix: 0.55, chorusFb: 0.75,
      reverbOn: true, reverbDecay: 4, reverbMix: 0.4,
    },
    formulas: { ocean: { gain: 0.5, oceanRate: 0.1, oceanCut: 700, oceanDepth: 0.8 } },
    reaction: { feed: 0.0545, kill: 0.062, speed: 22 },
    fieldVariation: { feedVarAmount: 0.014, feedVarScale: 4, feedVarWarp: 1.2, killVarAmount: 0.008, killVarScale: 5, killVarWarp: 1.2 },
    flow: { curlStrength: 0.005, curlScale: 3, driftY: 0.006, advectAmount: 0.14, evolveRate: 0.004 },
    palette: { paletteId: 1 },
    lfos: [{ shape: 'sine', rate: 0.02, phase: 0 }, { shape: 'triangle', rate: 0.01, phase: 0 }],
    routes: [
      { src: 0, target: 'flow', param: 'curlStrength', depth: 0.3 },
      { src: 1, target: 'palette', param: 'lightAngle', depth: 0.5 },
    ],
    coupling: { loudToFlow: 0.8, loudToCurl: 0.7, brightToShift: 0.4, loudToPulse: 0.9, onsetToFlash: 0.2, onsetToSeed: 0.2, spectrumToTint: 0.6 },
  }),

  preset('Bell spots', {
    // "Generative bells (S&H)" — a random source re-pitches the bell almost
    // every strike — over a spots pattern in the Glaze palette. The same S&H
    // steps the hue, so every bell lands in a new color; strikes flash the
    // light.
    fx: {
      ...LIMITED,
      reverbOn: true, reverbDecay: 5, reverbMix: 0.5,
      delayOn: true, delayTime: 0.5, delayFb: 0.35, delayMix: 0.3,
    },
    formulas: { bell: { gain: 0.3, bellF0: 320, bellRatio: 1.4, bellIndex: 4, bellDecay: 3, bellPeriod: 4 } },
    reaction: { feed: 0.025, kill: 0.06, speed: 12 },
    fieldVariation: { feedVarAmount: 0.005, feedVarScale: 5, feedVarWarp: 0.6, killVarAmount: 0.002, killVarScale: 6, killVarWarp: 0.6 },
    palette: { paletteId: 1, contrast: 1.2, gloss: 0.4 },
    lfos: [
      { shape: 'random', rate: 0.25, phase: 0 },
      { shape: 'sine', rate: 0.07, phase: 0 },
      { shape: 'triangle', rate: 0.03, phase: 0 },
    ],
    routes: [
      { src: 0, target: 'bell', param: 'bellF0', depth: 0.4, exp: true },
      { src: 1, target: 'bell', param: 'bellIndex', depth: 0.5 },
      { src: 0, target: 'palette', param: 'shift', depth: 0.3 },
      { src: 2, target: 'palette', param: 'lightAngle', depth: 0.3 },
    ],
    coupling: { onsetToLight: 0.9, loudToGloss: 0.5, loudToPulse: 0.5, onsetToFlash: 0.9, onsetToSeed: 1, spectrumToTint: 0.6 },
  }),

  preset('Subway basalt', {
    // "Waiting for the subway" (harmonic drone + Lorenz chaos + noise
    // through a flanger and a full-wet reverb) over a Basalt maze. Chaos in
    // the sound stirs the picture: loudness drives curl and advection.
    fx: {
      ...LIMITED,
      filterOn: true, filterType: 'lowpass', filterFreq: 2000, filterQ: 6.3,
      chorusOn: true, chorusMode: 'flanger', chorusRate: 0.98, chorusDepth: 5.7, chorusMix: 0.68, chorusFb: 0.45,
      reverbOn: true, reverbDecay: 3.2, reverbMix: 1,
    },
    formulas: {
      additive: { gain: 0.255, fund: 200, N: 5, move: 3.94 },
      lorenz: { gain: 0.498, sigma: 10, rho: 24.51, beta: 2.6667, lBase: 192, lFreqScale: 40, lAmp: 0.25 },
      noiselp: { gain: 0.081, nCut: 2085 },
    },
    reaction: { feed: 0.029, kill: 0.057, speed: 14 },
    flow: { curlStrength: 0.008, curlScale: 3, advectAmount: 0.2, evolveRate: 0.008 },
    palette: { paletteId: 4, contrast: 1.4, relief: 1.5, gloss: 0.5 },
    lfos: [{ shape: 'sine', rate: 0.02, phase: 0 }],
    routes: [{ src: 0, target: 'palette', param: 'lightAngle', depth: 0.4 }],
    coupling: { loudToCurl: 0.9, loudToFlow: 0.7, loudToGloss: 0.4, loudToPulse: 0.8, onsetToFlash: 0.4, onsetToSeed: 0.5, spectrumToTint: 0.7 },
  }),

  preset('Overtone steppe', {
    // Throat singing, built the way the FX-mod family people liked is built
    // (one dense harmonic grid, a band that never breaks, four LFOs at
    // unrelated rates) but with a move none of them makes: a peaking
    // resonance so narrow (Q 30, +20 dB) that it lifts ONE harmonic of the
    // 55 Hz drone at a time. Swept slowly across harmonics ~9…36, it sings a
    // whistled melody made of the drone's own overtone series — every note
    // is on the grid, nothing is ever cut away. Additive `move` is slow
    // (0.05 Hz) so its ripple doesn't swallow the chosen harmonic; the
    // phaser is what lifts fractality from ~0.46 to ~0.9 (analyze.mjs
    // --repeat). Measured against the liked family (--character --ref
    // 0,3,5,6,8): distance 0.94, inside the family's own spread (0.75–1.25).
    // The bass (2026-09-26, "the top is 5+, the bottom too rough — make it
    // more melodic and fat"): the roughness was the sawtooth's own low
    // harmonics, not the old tanh growl (removing it changed nothing below
    // 400 Hz). What cures it is a strong smooth fundamental under them: tanh
    // at α 0.9 is a warm, nearly pure 55 Hz sine, and the beating pair
    // breathes slower and louder. Same reverb rooms, three seeds: roughness
    // below 400 Hz −30%, fundamental 0.86–0.90 → 0.97 of the bass, low-mid
    // grit −6.5 dB, the band above 600 Hz unchanged to 0.0 dB.
    // Image: stripes = harmonics, blown sideways by a steady steppe wind
    // (Drift X) that erodes them into a pale haze. The LFO that sweeps the
    // whistle also swings the light across the ridges, and the triangle
    // that breathes the whistle's gain nudges Feed.
    masterGain: 0.72,
    fx: {
      ...LIMITED,
      filterOn: true, filterType: 'peaking', filterFreq: 1000, filterQ: 30, filterGain: 20,
      chorusOn: true, chorusMode: 'chorus', chorusRate: 0.05, chorusDepth: 5, chorusMix: 0.25, chorusFb: 0.2,
      phaserOn: true, phaserRate: 0.15, phaserDepth: 0.6, phaserStages: 6, phaserFb: 0.35, phaserMix: 0.35,
      delayOn: true, delayTime: 0.93, delayFb: 0.42, delayMix: 0.28,
      reverbOn: true, reverbDecay: 6, reverbMix: 0.42,
    },
    formulas: {
      additive: { gain: 0.55, fund: 55, N: 36, move: 0.05 },
      beats: { gain: 0.38, fbeat: 55, df: 0.25 },
      dist: { gain: 0.28, fd: 55, alpha: 0.9 },
    },
    reaction: { feed: 0.032, kill: 0.058, speed: 18 },
    fieldVariation: { feedVarAmount: 0.014, feedVarScale: 3, feedVarWarp: 1.4, killVarAmount: 0.007, killVarScale: 4, killVarWarp: 1.2 },
    flow: { curlStrength: 0.008, curlScale: 2.5, driftX: 0.005, advectAmount: 0.25, evolveRate: 0.006 },
    palette: { paletteId: 0, bands: 2, contrast: 1.2, relief: 1.4, gloss: 0.5 },
    lfos: [
      { shape: 'sine', rate: 0.019, phase: 0 },
      { shape: 'triangle', rate: 0.037, phase: 0.5 },
      { shape: 'sine', rate: 0.053, phase: 0.25 },
      { shape: 'random', rate: 0.029, phase: 0 },
    ],
    routes: [
      // The whistle: ±1 octave around 1 kHz (harmonics ~9…36), ~53 s a lap.
      { src: 0, target: 'fx', param: 'filterFreq', depth: 0.15, exp: true },
      { src: 1, target: 'fx', param: 'filterGain', depth: 0.12 },
      { src: 2, target: 'fx', param: 'chorusDepth', depth: 0.3 },
      { src: 2, target: 'fx', param: 'reverbMix', depth: 0.25 },
      // S&H every ~35 s: the drone's inner motion, the bass's breathing pace
      // (0.05–0.45 Hz — a step in drive would bring the grit back), the
      // echo tail.
      { src: 3, target: 'additive', param: 'move', depth: 0.08 },
      { src: 3, target: 'beats', param: 'df', depth: 0.01 },
      { src: 3, target: 'fx', param: 'delayFb', depth: 0.2 },
      { src: 0, target: 'palette', param: 'lightAngle', depth: 0.5 },
      { src: 1, target: 'reaction', param: 'feed', depth: 0.1 },
    ],
    coupling: { brightToShift: 0.6, loudToGloss: 0.5, onsetToLight: 0.3, loudToPulse: 0.7, onsetToFlash: 0.3, onsetToSeed: 0.4, spectrumToTint: 0.8 },
  }),

  preset('Candle glaze', {
    // Every LFO is pink (1/f, PLAN.md #18): the drone's flame, a resonant
    // low-pass over a 49 Hz grid, rises and sinks with the statistics of a
    // real flame, of wind or a heartbeat, at four unrelated rates, so it
    // never repeats. Three slow ones (0.013–0.034 Hz) carry the big
    // gestures (the flame's height, the beating pair, the echo); a fast one
    // (0.34 Hz) flickers the FM lace, because a flame flickers faster than
    // it breathes. Bass: a nearly pure 49 Hz sine (dist, α 0.9).
    // Picture: Glaze worms drifting up; the flame-height LFO also moves
    // Feed, the 0.034 Hz one turns the light, the slowest one the hue.
    // Measured (60 s, two seeded rooms): fractality 0.87 ± 0.08 against
    // 0.84 for the same preset on sine LFOs, whose timbre is smoother
    // (cenβ 1.48 vs 1.32; 1 is 1/f). Distance 0.94 to the liked family.
    masterGain: 0.72,
    fx: {
      ...LIMITED,
      filterOn: true, filterType: 'lowpass', filterFreq: 1400, filterQ: 4,
      chorusOn: true, chorusMode: 'chorus', chorusRate: 0.06, chorusDepth: 6, chorusMix: 0.3, chorusFb: 0.2,
      phaserOn: true, phaserRate: 0.2, phaserDepth: 0.6, phaserStages: 6, phaserFb: 0.35, phaserMix: 0.35,
      delayOn: true, delayTime: 0.71, delayFb: 0.4, delayMix: 0.25,
      reverbOn: true, reverbDecay: 5.5, reverbMix: 0.4,
    },
    formulas: {
      additive: { gain: 0.5, fund: 49, N: 28, move: 0.08 },
      dist: { gain: 0.26, fd: 49, alpha: 0.9 },
      fm: { gain: 0.14, fc: 392, fm: 49, I: 3 },
      beats: { gain: 0.22, fbeat: 98, df: 0.3 },
    },
    reaction: { feed: 0.037, kill: 0.06, speed: 16 },
    fieldVariation: { feedVarAmount: 0.008, feedVarScale: 3, feedVarWarp: 1.2, killVarAmount: 0.004, killVarScale: 4, killVarWarp: 1 },
    flow: { curlStrength: 0.01, curlScale: 2.5, driftY: -0.003, advectAmount: 0.3, evolveRate: 0.008 },
    palette: { paletteId: 1, contrast: 1.2, relief: 1.2, gloss: 0.45 },
    lfos: [
      { shape: 'pink', rate: 0.021, phase: 0 },
      { shape: 'pink', rate: 0.034, phase: 0.3 },
      { shape: 'pink', rate: 0.34, phase: 0.6 },
      { shape: 'pink', rate: 0.013, phase: 0.9 },
    ],
    routes: [
      { src: 0, target: 'fx', param: 'filterFreq', depth: 0.25, exp: true },
      { src: 0, target: 'reaction', param: 'feed', depth: 0.15 },
      { src: 2, target: 'fm', param: 'I', depth: 0.15 },
      { src: 1, target: 'palette', param: 'lightAngle', depth: 0.4 },
      { src: 2, target: 'fx', param: 'chorusDepth', depth: 0.3 },
      { src: 2, target: 'fx', param: 'reverbMix', depth: 0.2 },
      { src: 3, target: 'beats', param: 'df', depth: 0.01 },
      { src: 3, target: 'fx', param: 'delayFb', depth: 0.15 },
      { src: 3, target: 'palette', param: 'shift', depth: 0.1 },
    ],
    coupling: { brightToShift: 0.4, loudToGloss: 0.5, onsetToLight: 0.3, loudToPulse: 0.7, onsetToFlash: 0.3, onsetToSeed: 0.4, spectrumToTint: 0.6 },
  }),

  preset('Tanpura halo', {
    // A drone that breathes in plucks (PLAN.md #20): four tanpura strings
    // Pa–Sa–Sa–Sa on a 65 Hz Sa, plucked in a 7 s cycle, with the jawari
    // buzz (a pink LFO lets it come and go), a round 65 Hz sine under them,
    // and an echo that climbs an octave on every pass: the halo. One sine
    // LFO swells the shimmer and the picture's gloss and light together.
    // Picture: Verdigris cells that divide (Pearson η, F 0.034, k 0.063);
    // every pluck the onset detector hears seeds a new cell and a ripple.
    // Measured (60 s, two seeded rooms): distance 0.91 to the liked family,
    // no metric beyond 2 sd; dropout 4.6 dB; 20–23 onset hits per 30 s (the
    // detector hears nearly every pluck and some echoes). Shimmer on vs off:
    // +4 dB at 4–8 kHz, +12.5 dB above 8 kHz, within 0.2 dB below 2 kHz.
    // Fractality 0.67 ± 0.07: the fat sine (gain 0.42, low-end share 0.84)
    // smooths the loudness contour. At 0.3 it read 0.87 with a thin bottom
    // (0.62); the bass won (the user's taste: round and fat).
    masterGain: 0.68,
    fx: {
      ...LIMITED,
      filterOn: true, filterType: 'lowpass', filterFreq: 2000, filterQ: 0.7,
      chorusOn: true, chorusMode: 'chorus', chorusRate: 0.05, chorusDepth: 5, chorusMix: 0.25, chorusFb: 0.15,
      delayOn: true, delayTime: 0.75, delayFb: 0.55, delayMix: 0.35, delayShimmer: 0.5,
      reverbOn: true, reverbDecay: 7, reverbMix: 0.45,
    },
    formulas: {
      tanpura: { gain: 1, tanSa: 65, tanCycle: 7, tanJawari: 0.6, tanSustain: 16, tanBright: 0.3 },
      dist: { gain: 0.42, fd: 65, alpha: 0.9 },
    },
    reaction: { feed: 0.034, kill: 0.063, speed: 14 },
    flow: { curlStrength: 0.006, curlScale: 3, advectAmount: 0.2, evolveRate: 0.006 },
    palette: { paletteId: 2, bands: 2, contrast: 1.2, relief: 1.2, gloss: 0.5 },
    lfos: [
      { shape: 'sine', rate: 0.019, phase: 0 },
      { shape: 'pink', rate: 0.029, phase: 0.5 },
      { shape: 'triangle', rate: 0.041, phase: 0.25 },
      { shape: 'random', rate: 0.023, phase: 0 },
    ],
    routes: [
      { src: 0, target: 'fx', param: 'delayShimmer', depth: 0.3 },
      { src: 0, target: 'palette', param: 'gloss', depth: 0.3 },
      { src: 1, target: 'tanpura', param: 'tanJawari', depth: 0.2 },
      { src: 2, target: 'fx', param: 'reverbMix', depth: 0.2 },
      { src: 2, target: 'fx', param: 'chorusDepth', depth: 0.3 },
      { src: 3, target: 'fx', param: 'delayFb', depth: 0.1 },
      { src: 0, target: 'palette', param: 'lightAngle', depth: 0.4 },
    ],
    coupling: { loudToGloss: 0.4, onsetToLight: 0.4, loudToPulse: 0.6, onsetToFlash: 0.25, onsetToSeed: 0.6, spectrumToTint: 0.5 },
  }),
];

export const DEFAULT_PRESET_INDEX = 0;

