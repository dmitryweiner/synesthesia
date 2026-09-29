// The ⚙ Settings page's pure model (src/ui/settingsModel.ts): slider scales,
// which controls exist and with what ranges, the filter's type-dependent
// rows, the 5-formula cap, the route list per tab — and the one property the
// page depends on: whatever it lets you set survives the genome, so closing
// the settings commits exactly what you heard.
import {
  COUPLING_CONTROLS, FX_CARDS, LFO_RATE_SCALE, LFO_SHAPE_LABELS, LOG_STEPS,
  canAddRoute, canEnableFormula, filterControls, formatValue, fromSliderPos, isLogScale,
  isTargetOn, modulatedKeys, newRoute, rangeAttrs, routeDomain, samePoint, setFxChoice,
  targetGroups, toSliderPos, vowelLabel,
} from '../src/ui/settingsModel';
import type { Scale } from '../src/ui/settingsModel';
import { FX_PRESETS, applyFxPreset } from '../src/fxPresets';
import {
  CHORUS_MODES, DEFAULT_FX, FILTER_TYPES, FORMULAS, FX_MOD_PARAMS, FX_ON_KEYS, FX_PARAM_MODULE,
  MAX_ENABLED_FORMULAS, PHASER_STAGES, isFxModParam,
} from '../src/schema/audio';
import { CARDS } from '../src/schema/visual';
import type { AppState } from '../src/state/schema';
import {
  COUPLING_KEYS, COUPLING_RANGES, cloneAppState, defaultAppState, sanitizeState, stateToAppState,
} from '../src/state/schema';
import { LFO_SHAPE_LIST } from '../src/dsp/mod';
import { LFO_RATE_RANGE, MOD_TARGETS, ROUTE_SLOTS, geneById, modTargetIndex } from '../src/genome/genes';
import { decodeGenome, encodeGenome } from '../src/genome/codec';
import { PRESETS } from '../src/presets';

describe('slider scale', () => {
  const lin: Scale = { min: 0, max: 10, step: 0.01 };
  const hz: Scale = { min: 20, max: 2000, step: 1, exp: true };
  const lfo: Scale = { min: 0.003, max: 2, exp: true };

  it('a linear slider is the value itself', () => {
    expect(isLogScale(lin)).toBe(false);
    expect(rangeAttrs(lin)).toEqual({ min: 0, max: 10, step: 0.01 });
    expect(toSliderPos(lin, 3.3)).toBe(3.3);
    expect(fromSliderPos(lin, 3.3)).toBe(3.3);
    expect(fromSliderPos(lin, 12)).toBe(10);
  });

  it('a frequency-like slider moves in octaves: the ends are min/max, the middle is the geometric mean', () => {
    expect(isLogScale(hz)).toBe(true);
    expect(rangeAttrs(hz)).toEqual({ min: 0, max: LOG_STEPS, step: 1 });
    expect(toSliderPos(hz, 20)).toBe(0);
    expect(toSliderPos(hz, 2000)).toBe(LOG_STEPS);
    expect(fromSliderPos(hz, LOG_STEPS / 2)).toBe(200);
    expect(fromSliderPos(lfo, 0)).toBeCloseTo(0.003, 12);
    expect(fromSliderPos(lfo, LOG_STEPS)).toBeCloseTo(2, 12);
    // out-of-range positions and values clamp
    expect(fromSliderPos(hz, -5)).toBe(20);
    expect(toSliderPos(hz, 1e6)).toBe(LOG_STEPS);
  });

  it('whole-step exp values come out whole (the genome decodes step ≥ 1 genes rounded)', () => {
    for (let pos = 0; pos <= LOG_STEPS; pos += 37) expect(Number.isInteger(fromSliderPos(hz, pos))).toBe(true);
  });

  it('pos → value → pos is stable, so a synced slider does not creep', () => {
    for (let pos = 0; pos <= LOG_STEPS; pos += 37) expect(toSliderPos(lfo, fromSliderPos(lfo, pos))).toBe(pos);
  });

  it('exp over a range that touches zero falls back to linear', () => {
    expect(isLogScale({ min: 0, max: 1, exp: true })).toBe(false);
  });
});

describe('formatValue', () => {
  it('shows as many decimals as the step has', () => {
    expect(formatValue(0.037, 0.0005)).toBe('0.0370');
    expect(formatValue(110, 1)).toBe('110');
    expect(formatValue(2.6667, 0.0001)).toBe('2.6667');
    expect(formatValue(-12, 0.5)).toBe('-12.0');
  });

  it('without a step: three significant digits below 1, fewer decimals above', () => {
    expect(formatValue(0.05)).toBe('0.05');
    expect(formatValue(0.00312)).toBe('0.00312');
    expect(formatValue(1.5)).toBe('1.50');
    expect(formatValue(12.34)).toBe('12.3');
    expect(formatValue(440.2)).toBe('440');
  });
});

describe('effects controls', () => {
  const sliders = FX_CARDS.flatMap((c) => c.sliders.map((s) => ({ card: c, s })));

  it('every effect has one card, in the order the chain runs', () => {
    expect(FX_CARDS.map((c) => c.on)).toEqual(['filterOn', 'chorusOn', 'phaserOn', 'delayOn', 'reverbOn', 'limiterOn']);
    expect([...FX_CARDS.map((c) => c.on)].sort()).toEqual([...FX_ON_KEYS].sort());
  });

  it('every numeric FX field has exactly one slider, on its own module, with its gene range', () => {
    const keys = sliders.map(({ s }) => s.k);
    expect([...keys].sort()).toEqual([...FX_MOD_PARAMS, 'reverbDecay'].sort());
    for (const { card, s } of sliders) {
      const gene = geneById(`fx.${s.k}`);
      expect(gene, s.k).toBeDefined();
      expect([s.min, s.max], s.k).toEqual([gene?.min, gene?.max]);
      expect(s.exp === true, s.k).toBe(gene?.exp === true);
      expect(card.on, s.k).toBe(isFxModParam(s.k) ? FX_PARAM_MODULE[s.k] : 'reverbOn');
      expect(s.step, s.k).toBeGreaterThan(0);
    }
  });

  it('the choices offer exactly what the engine accepts', () => {
    const choices = new Map(FX_CARDS.flatMap((c) => c.choices.map((ch) => [ch.k, ch.options.map((o) => o.value)])));
    expect(choices.get('filterType')).toEqual([...FILTER_TYPES]);
    expect(choices.get('chorusMode')).toEqual([...CHORUS_MODES]);
    expect(choices.get('phaserStages')).toEqual(PHASER_STAGES.map(String));
  });

  it('setFxChoice parses what a <select> hands back and ignores anything else', () => {
    const fx = { ...DEFAULT_FX };
    setFxChoice(fx, 'filterType', 'comb');
    setFxChoice(fx, 'chorusMode', 'flanger');
    setFxChoice(fx, 'phaserStages', '8');
    expect([fx.filterType, fx.chorusMode, fx.phaserStages]).toEqual(['comb', 'flanger', 8]);
    setFxChoice(fx, 'filterType', 'wah');
    setFxChoice(fx, 'phaserStages', '5');
    expect([fx.filterType, fx.phaserStages]).toEqual(['comb', 8]);
  });

  it('the filter shows only the rows its type uses (formula-synth rules)', () => {
    expect(filterControls('lowpass')).toMatchObject({ q: true, gain: false, vowel: false, comb: false, freqLabel: 'Cutoff (Hz)', qLabel: 'Q' });
    expect(filterControls('peaking')).toMatchObject({ q: true, gain: true, vowel: false, comb: false, freqLabel: 'Frequency (Hz)' });
    expect(filterControls('highshelf')).toMatchObject({ gain: true, freqLabel: 'Cutoff (Hz)' });
    expect(filterControls('formant')).toMatchObject({ q: true, gain: false, vowel: true, comb: false, freqLabel: 'Formant shift (Hz)', qLabel: 'Resonance' });
    expect(filterControls('comb')).toMatchObject({ q: false, gain: false, vowel: false, comb: true, freqLabel: 'Pitch (Hz)' });
  });

  it('vowels A–E–I–O–U', () => {
    expect([0, 0.25, 0.5, 0.75, 1].map(vowelLabel).join('')).toBe('AEIOU');
    expect(vowelLabel(0.6)).toBe('I');
  });
});

describe('effect presets (ported from formula-synth)', () => {
  it('each sets only its own fields, and every value survives sanitize + clamp', () => {
    for (const p of FX_PRESETS) {
      const fx = applyFxPreset(DEFAULT_FX, p);
      const got = new Map(Object.entries(fx));
      for (const [k, v] of Object.entries(DEFAULT_FX)) {
        if (!(k in p.fx)) expect(got.get(k), `${p.name}: ${k}`).toBe(v);
      }
      const back = stateToAppState(sanitizeState({ audio: { fx } }) ?? {}).audio.fx;
      expect(back, p.name).toEqual(fx);
    }
  });

  it('does not touch the fx it is applied to', () => {
    const fx = { ...DEFAULT_FX };
    applyFxPreset(fx, FX_PRESETS[0]);
    expect(fx).toEqual(DEFAULT_FX);
  });
});

describe('formulas: at most five at once', () => {
  function withEnabled(n: number): AppState {
    const s = defaultAppState();
    FORMULAS.slice(0, n).forEach((f) => { s.audio.formulas[f.id].enabled = true; });
    return s;
  }

  it('a sixth cannot be switched on; the five on stay switchable', () => {
    const s = withEnabled(MAX_ENABLED_FORMULAS);
    expect(canEnableFormula(s, FORMULAS[MAX_ENABLED_FORMULAS].id)).toBe(false);
    expect(canEnableFormula(s, FORMULAS[0].id)).toBe(true);
    expect(canEnableFormula(withEnabled(MAX_ENABLED_FORMULAS - 1), FORMULAS[MAX_ENABLED_FORMULAS].id)).toBe(true);
  });
});

describe('modulation', () => {
  it('effects and formulas are sound, cards are picture', () => {
    expect(routeDomain('fx')).toBe('sound');
    expect(routeDomain('tanpura')).toBe('sound');
    expect(routeDomain('palette')).toBe('picture');
    expect(routeDomain('reaction')).toBe('picture');
  });

  it('the two tabs together offer every genome mod target once — and nothing the genome would drop', () => {
    const offered: string[] = [];
    for (const domain of ['sound', 'picture'] as const) {
      for (const g of targetGroups(domain)) {
        for (const p of g.params) {
          expect(routeDomain(g.id)).toBe(domain);
          const i = modTargetIndex(g.id, p.k);
          expect(i, `${g.id}.${p.k}`).toBeGreaterThanOrEqual(0);
          expect(p.exp).toBe(MOD_TARGETS[i].exp);
          offered.push(`${g.id}.${p.k}`);
        }
      }
    }
    expect(offered.length).toBe(MOD_TARGETS.length);
    expect(new Set(offered).size).toBe(MOD_TARGETS.length);
    const sound = targetGroups('sound');
    expect(sound[sound.length - 1].id).toBe('fx');
    expect(targetGroups('picture').map((g) => g.id)).toEqual(CARDS.map((c) => c.id));
  });

  it('a target is on when its formula or card is on; effects always are', () => {
    const s = defaultAppState();
    expect(isTargetOn(s, 'fx')).toBe(true);
    expect(isTargetOn(s, 'fm')).toBe(false);
    s.audio.formulas.fm.enabled = true;
    expect(isTargetOn(s, 'fm')).toBe(true);
    expect(isTargetOn(s, 'reaction')).toBe(true);
    expect(isTargetOn(s, 'flow')).toBe(s.visual.cards.flow.on);
  });

  it('a new route aims at something that is on, with the schema\'s octave flag', () => {
    const s = defaultAppState();
    expect(newRoute(s, 'sound')).toMatchObject({ src: 0, target: 'fx' });
    s.audio.formulas.bowl.enabled = true;
    const r = newRoute(s, 'sound');
    expect(r.target).toBe('bowl');
    expect(r.exp === true).toBe(MOD_TARGETS[modTargetIndex(r.target, r.param)].exp);
    expect(newRoute(s, 'picture').target).toBe('reaction');
    expect(Math.abs(newRoute(s, 'picture').depth)).toBeGreaterThan(0);
  });

  it(`at most ${ROUTE_SLOTS} routes, sound and picture together`, () => {
    const s = defaultAppState();
    for (let i = 0; i < ROUTE_SLOTS; i++) {
      expect(canAddRoute(s)).toBe(true);
      s.mod.routes.push(newRoute(s, i % 2 ? 'sound' : 'picture'));
    }
    expect(canAddRoute(s)).toBe(false);
  });

  it('modulated keys name the target.param of every route that moves something', () => {
    const keys = modulatedKeys([
      { src: 0, target: 'fx', param: 'filterFreq', depth: 0.3 },
      { src: 1, target: 'palette', param: 'shift', depth: 0 },
      { src: 2, target: 'bowl', param: 'bowlF', depth: -0.1 },
    ]);
    expect([...keys].sort()).toEqual(['bowl.bowlF', 'fx.filterFreq']);
  });

  it('every LFO shape has a label, and the rate slider spans the gene range in octaves', () => {
    expect(Object.keys(LFO_SHAPE_LABELS).sort()).toEqual([...LFO_SHAPE_LIST].sort());
    expect([LFO_RATE_SCALE.min, LFO_RATE_SCALE.max]).toEqual([...LFO_RATE_RANGE]);
    expect(isLogScale(LFO_RATE_SCALE)).toBe(true);
  });
});

describe('sound → image controls', () => {
  it('one per coupling gene, with its range', () => {
    expect(COUPLING_CONTROLS.map((c) => c.k)).toEqual([...COUPLING_KEYS]);
    for (const c of COUPLING_CONTROLS) expect([c.min, c.max]).toEqual([...COUPLING_RANGES[c.k]]);
  });
});

describe('samePoint', () => {
  it('ignores float noise from the genome codec, the volume and the name', () => {
    const s = cloneAppState(PRESETS[0].state);
    const back = decodeGenome(encodeGenome(s));
    expect(samePoint(s, back)).toBe(true);
    back.audio.masterGain = 0.1;
    back.presetName = 'renamed';
    expect(samePoint(s, back)).toBe(true);
  });

  it('sees any change a control can make', () => {
    const s = cloneAppState(PRESETS[0].state);
    const a = cloneAppState(s);
    a.audio.fx.delayMix += 0.01;
    expect(samePoint(s, a)).toBe(false);
    const b = cloneAppState(s);
    b.mod.lfos[2].shape = b.mod.lfos[2].shape === 'pink' ? 'sine' : 'pink';
    expect(samePoint(s, b)).toBe(false);
    const c = cloneAppState(s);
    c.visual.cards.palette.params.paletteId = (c.visual.cards.palette.params.paletteId + 1) % 5;
    expect(samePoint(s, c)).toBe(false);
  });
});

describe('a point set in the settings survives the genome unchanged', () => {
  // A value a slider can actually produce at fraction t of its travel.
  function at(scale: Scale & { step?: number }, t: number): number {
    const r = rangeAttrs(scale);
    const pos = r.min + Math.round((t * (r.max - r.min)) / r.step) * r.step;
    return fromSliderPos(scale, pos);
  }

  it.each([0, 0.37, 0.81, 1])('every control at %s of its travel', (t) => {
    const s = defaultAppState();
    FORMULAS.forEach((f, i) => {
      const snap = s.audio.formulas[f.id];
      snap.enabled = i % 5 === 0;
      for (const sl of f.sliders) snap.params[sl.k] = at(sl, t);
    });
    for (const card of FX_CARDS) {
      s.audio.fx[card.on] = t > 0.5;
      for (const sl of card.sliders) s.audio.fx[sl.k] = at(sl, t);
    }
    setFxChoice(s.audio.fx, 'filterType', FILTER_TYPES[Math.round(t * (FILTER_TYPES.length - 1))]);
    for (const c of CARDS) {
      const card = s.visual.cards[c.id];
      card.on = true;
      for (const sl of c.sliders) card.params[sl.k] = at(sl, t);
      for (const sel of c.selects ?? []) card.params[sel.k] = sel.options[Math.round(t * (sel.options.length - 1))].v;
    }
    s.mod.lfos = s.mod.lfos.map((_l, i) => ({ shape: LFO_SHAPE_LIST[i + 1], rate: at(LFO_RATE_SCALE, t), phase: at({ min: 0, max: 1, step: 0.01 }, t) }));
    const groups = [...targetGroups('sound'), ...targetGroups('picture')];
    s.mod.routes = [];
    for (let i = 0; i < ROUTE_SLOTS; i++) {
      const g = groups[(i * 7) % groups.length];
      const p = g.params[i % g.params.length];
      s.mod.routes.push({ src: i % 4, target: g.id, param: p.k, depth: at({ min: -1, max: 1, step: 0.01 }, t), ...(i % 3 ? {} : { exp: true }) });
    }
    for (const c of COUPLING_CONTROLS) s.coupling[c.k] = at(c, t);

    expect(samePoint(s, decodeGenome(encodeGenome(s)))).toBe(true);
  });
});
