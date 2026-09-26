// "What is this point made of": a read-only summary of the current state.
// Pure DOM building, no app logic.
import type { AppState } from '../state/schema';
import { COUPLING_KEYS } from '../state/schema';
import { FORMULAS, FX_ON_KEYS, FX_PARAM_LABELS, isFxModParam } from '../schema/audio';
import { CARDS } from '../schema/visual';
import { COUPLING_LABELS } from '../coupling';
import type { SoundAnalysis } from '../analysis/fractal';
import { make } from './dom';

function fmt(v: number): string {
  if (Number.isInteger(v)) return String(v);
  const a = Math.abs(v);
  if (a >= 100) return v.toFixed(0);
  if (a >= 10) return v.toFixed(1);
  if (a >= 1) return v.toFixed(2);
  return v.toFixed(3);
}

function section(root: HTMLElement, title: string, items: string[]): void {
  root.appendChild(make('h3', undefined, title));
  const ul = make('ul');
  for (const it of items) ul.appendChild(make('li', undefined, it));
  if (items.length === 0) ul.appendChild(make('li', 'mono', '—'));
  root.appendChild(ul);
}

const FX_LABEL: Record<(typeof FX_ON_KEYS)[number], string> = {
  filterOn: 'Filter', chorusOn: 'Chorus', reverbOn: 'Reverb', limiterOn: 'Limiter', delayOn: 'Delay', phaserOn: 'Phaser',
};

/** Fills the details panel's body (the panel itself keeps its close button). */
export function renderDetails(root: HTMLElement, state: AppState, analysis: SoundAnalysis | null = null): void {
  root.replaceChildren();

  if (analysis) {
    const b = (v: number) => (Number.isFinite(v) ? v.toFixed(2) : 'static');
    section(root, 'Fractality (offline render)', analysis.silent ? ['silent'] : [
      `score ${analysis.score.toFixed(2)} of 1`,
      `loudness 1/f β ${b(analysis.envBeta)} · timbre 1/f β ${b(analysis.centroidBeta)} (pink = 1)`,
      `spectrogram box dimension ${analysis.boxDim.toFixed(2)} · ${analysis.loudness.toFixed(0)} dBFS`,
    ]);
  }

  const formulas: string[] = [];
  for (const f of FORMULAS) {
    const snap = state.audio.formulas[f.id];
    if (!snap?.enabled) continue;
    const parts = f.sliders.slice(0, 4).map((s) => `${s.name.replace(/ \(.*\)/, '')} ${fmt(snap.params[s.k])}`);
    formulas.push(`${f.title}: ${parts.join(', ')}`);
  }
  section(root, 'Sound', formulas);

  const fx: string[] = [];
  for (const on of FX_ON_KEYS) {
    if (!state.audio.fx[on]) continue;
    let extra = '';
    if (on === 'filterOn') extra = ` ${state.audio.fx.filterType} ${fmt(state.audio.fx.filterFreq)} Hz`;
    if (on === 'chorusOn') extra = ` ${state.audio.fx.chorusMode}`;
    if (on === 'delayOn') extra = ` ${fmt(state.audio.fx.delayTime)} s${state.audio.fx.delayShimmer > 0.02 ? `, shimmer ${fmt(state.audio.fx.delayShimmer)}` : ''}`;
    if (on === 'reverbOn') extra = ` ${fmt(state.audio.fx.reverbDecay)} s`;
    fx.push(FX_LABEL[on] + extra);
  }
  section(root, 'Effects', fx);

  const visual: string[] = [];
  for (const c of CARDS) {
    const card = state.visual.cards[c.id];
    if (!card?.on) continue;
    const sel = (c.selects ?? []).map((s) => s.options.find((o) => o.v === card.params[s.k])?.label ?? '').filter(Boolean);
    const parts = c.sliders.slice(0, 3).map((s) => `${s.name.replace(/ \(.*\)/, '')} ${fmt(card.params[s.k])}`);
    visual.push(`${c.title}: ${[...sel, ...parts].join(', ')}`);
  }
  section(root, 'Image', visual);

  const routes = state.mod.routes.map((r) => {
    const lfo = state.mod.lfos[r.src];
    let target = `${r.target}.${r.param}`;
    if (r.target === 'fx' && isFxModParam(r.param)) target = FX_PARAM_LABELS[r.param];
    return `LFO${r.src + 1} ${lfo?.shape ?? ''} ${lfo ? fmt(lfo.rate) : ''} Hz → ${target} ${r.depth >= 0 ? '+' : ''}${fmt(r.depth)}`;
  });
  section(root, 'Modulation', routes);

  const coupling = COUPLING_KEYS
    .filter((k) => Math.abs(state.coupling[k]) > 0.01)
    .map((k) => `${COUPLING_LABELS[k]} ${state.coupling[k] >= 0 ? '+' : ''}${fmt(state.coupling[k])}`);
  section(root, 'Sound → image', coupling);

  section(root, 'Build', [typeof __BUILD__ === 'string' ? `${__BUILD__} UTC` : 'dev']);
}
