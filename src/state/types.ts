// The point's shape, for TypeScript only: AppState v1 as the core writes and
// reads it (synesthesia-core syn_core::state). No logic lives here — making a
// point safe, its canonical form, its id, the presets, the ranges and labels
// are all the core's (PLAN-CORE.md C2), reached through src/core/*.

export type Params = Record<string, number>;

export type FilterType =
  | 'lowpass' | 'highpass' | 'bandpass' | 'notch' | 'peaking' | 'lowshelf' | 'highshelf' | 'allpass' | 'formant' | 'comb';
export type ChorusMode = 'chorus' | 'flanger';

export interface FxState {
  filterOn: boolean; filterType: FilterType; filterFreq: number; filterQ: number;
  filterGain: number; filterVowel: number; filterCombFb: number;
  chorusOn: boolean; chorusMode: ChorusMode; chorusRate: number; chorusDepth: number;
  chorusMix: number; chorusFb: number;
  reverbOn: boolean; reverbDecay: number; reverbMix: number;
  limiterOn: boolean; limiterThr: number; limiterRel: number;
  delayOn: boolean; delayTime: number; delayFb: number; delayMix: number;
  delayShimmer: number;
  phaserOn: boolean; phaserRate: number; phaserDepth: number; phaserStages: number;
  phaserFb: number; phaserMix: number;
}

export type LfoShape = 'sine' | 'triangle' | 'saw' | 'square' | 'random' | 'pink';

export interface LfoDef { shape: LfoShape; rate: number; phase: number }

export interface ModRoute {
  src: number;     // index into the LFO pool
  target: string;  // 'fx' | formula id | visual card id
  param: string;   // slider key / FxState field
  depth: number;   // bipolar fraction of the range, [-1, 1]
  exp?: boolean;   // octave mapping for frequency-like params
}

export interface ModState { lfos: LfoDef[]; routes: ModRoute[] }

export interface FormulaSnapshot { enabled: boolean; params: Params }
export interface CardState { on: boolean; params: Params }

export interface AppState {
  v: 1;
  presetName?: string;
  audio: { masterGain: number; fx: FxState; formulas: Record<string, FormulaSnapshot> };
  visual: { cards: Record<string, CardState> };
  mod: ModState;
  coupling: Record<string, number>;
}

/** A slider as the core's schema describes it. */
export interface SliderDef { k: string; name: string; min: number; max: number; step: number; value: number; exp?: boolean }
export interface SelectDef { k: string; name: string; value: number; options: { v: number; label: string }[] }
export interface FormulaDef { id: string; title: string; tag: string; desc: string; sliders: SliderDef[] }
export interface CardDef { id: string; title: string; tag: string; desc: string; sliders: SliderDef[]; selects?: SelectDef[] }

/** What the picture reads about the sound (the core's AudioFeatures). */
export interface AudioFeatures {
  loudness: number;   // 0..1, smoothed RMS
  swell: number;      // -1..1, loudness against its ~4 s average
  brightness: number; // 0..1, spectral centroid on a log scale
  onset: number;      // 0..1, decaying spike on spectral energy jumps
  low: number;        // 0..1, 30–250 Hz
  mid: number;        // 0..1, 250–2000 Hz
  high: number;       // 0..1, 2–10 kHz
}
