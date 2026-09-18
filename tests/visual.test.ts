import { CARDS, cardDef, cardSliderRanges, isCardId, isVisualModTarget, PALETTE_NAMES, DEFAULT_OFF_CARD_IDS } from '../src/schema/visual';
import {
  DEFAULT_REACTION_PARAMS, ZERO_FIELD_VARIATION, ZERO_FLOW,
  reactionParamsFromCard, fieldVariationParamsFromCard, flowParamsFromCard, PEARSON_POINTS,
} from '../src/sim/params';
import { BUILTIN_PALETTES, composePalette, hexToVec3, palettesByIndex } from '../src/palette';

describe('schema/visual', () => {
  it('cards: reaction, fieldVariation, flow, palette', () => {
    expect(CARDS.map((c) => c.id)).toEqual(['reaction', 'fieldVariation', 'flow', 'palette']);
    expect(isCardId('flow')).toBe(true);
    expect(isCardId('veins')).toBe(false);
  });

  it('slider defaults within range; select defaults are valid options', () => {
    for (const c of CARDS) {
      for (const s of c.sliders) {
        expect(s.value, `${c.id}.${s.k}`).toBeGreaterThanOrEqual(s.min);
        expect(s.value, `${c.id}.${s.k}`).toBeLessThanOrEqual(s.max);
      }
      for (const s of c.selects ?? []) {
        expect(s.options.some((o) => o.v === s.value)).toBe(true);
      }
    }
  });

  it('palette names line up with the built-in cosine palettes', () => {
    expect([...PALETTE_NAMES]).toEqual(BUILTIN_PALETTES.map((p) => p.name));
  });

  it('cardSliderRanges / isVisualModTarget', () => {
    const r = cardSliderRanges(cardDef('reaction')!);
    expect(r.feed).toEqual([0.01, 0.09]);
    expect(isVisualModTarget('reaction', 'feed')).toBe(true);
    expect(isVisualModTarget('palette', 'paletteId')).toBe(false); // selects aren't targets
    expect(isVisualModTarget('nope', 'feed')).toBe(false);
  });

  it('reaction and palette are always on; fieldVariation/flow default off', () => {
    expect([...DEFAULT_OFF_CARD_IDS].sort()).toEqual(['fieldVariation', 'flow']);
  });
});

describe('sim/params', () => {
  it('reactionParamsFromCard: reads keys, falls back to defaults', () => {
    expect(reactionParamsFromCard({})).toEqual(DEFAULT_REACTION_PARAMS);
    expect(reactionParamsFromCard({ feed: 0.05 }).feed).toBe(0.05);
  });

  it('fieldVariation/flow: {} → ZERO_* (exact no-op values)', () => {
    expect(fieldVariationParamsFromCard({})).toEqual(ZERO_FIELD_VARIATION);
    expect(flowParamsFromCard({})).toEqual(ZERO_FLOW);
    expect(ZERO_FLOW.advectAmount).toBe(0);
    expect(ZERO_FIELD_VARIATION.feedVarAmount).toBe(0);
  });

  it('flow round-trips all six fields', () => {
    const src = { curlStrength: 0.01, curlScale: 2, driftX: 0.001, driftY: -0.002, advectAmount: 0.3, evolveRate: 0.02 };
    expect(flowParamsFromCard(src)).toEqual(src);
  });

  it('Pearson points sit inside the reaction slider ranges', () => {
    const card = cardDef('reaction')!;
    const feed = card.sliders.find((s) => s.k === 'feed')!;
    const kill = card.sliders.find((s) => s.k === 'kill')!;
    for (const p of PEARSON_POINTS) {
      expect(p.feed).toBeGreaterThanOrEqual(feed.min);
      expect(p.feed).toBeLessThanOrEqual(feed.max);
      expect(p.kill).toBeGreaterThanOrEqual(kill.min);
      expect(p.kill).toBeLessThanOrEqual(kill.max);
    }
  });
});

describe('palette', () => {
  it('palettesByIndex falls back to the first palette', () => {
    expect(palettesByIndex(1)).toBe(BUILTIN_PALETTES[1]);
    expect(palettesByIndex(99)).toBe(BUILTIN_PALETTES[0]);
    expect(palettesByIndex(-1)).toBe(BUILTIN_PALETTES[0]);
  });

  it('composePalette folds shift into d and contrast into b', () => {
    const base = BUILTIN_PALETTES[0];
    const u = composePalette(base, 0.25, 2, 3, 1.5, 1.2, 0.4);
    expect(u.a).toEqual(base.a);
    expect(u.b).toEqual([base.b[0] * 2, base.b[1] * 2, base.b[2] * 2]);
    expect(u.d).toEqual([base.d[0] + 0.25, base.d[1] + 0.25, base.d[2] + 0.25]);
    expect(u.bands).toBe(3);
    expect(u.relief).toBe(1.5);
    expect(u.lightAngle).toBe(1.2);
    expect(u.gloss).toBe(0.4);
  });

  it('hexToVec3', () => {
    expect(hexToVec3(0xff0000)).toEqual([1, 0, 0]);
    expect(hexToVec3(0x00ff00)).toEqual([0, 1, 0]);
    expect(hexToVec3(0x0000ff)).toEqual([0, 0, 1]);
    expect(hexToVec3(-5)).toEqual([0, 0, 0]);
  });
});
