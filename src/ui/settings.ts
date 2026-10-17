// ⚙ Settings: every parameter of the current point, for the curious — a
// full-screen page with two tabs. Audio is ../formula-synth's panel
// (formula cards, the effects chain with its presets, LFO routes to sound),
// Video is ../chromaflux's (the reaction/flow/palette cards, LFO routes to
// the picture) plus this app's own sound → image links.
//
// The page edits the point it is given in place and says what changed:
// onSound for anything audible (main.ts pushes it to the engine at once),
// nothing for the picture — the frame loop is paused while the page is
// open, so picture changes show when it closes. Closing is main.ts's job
// (it commits the point as one undoable step).
import type { AppState } from '../state/types';
import { make } from './dom';
import { setupAdjustmentButtons } from './adjust';
import { card, fillSelect, selectRow, sliderRow } from './controls';
import type { Card } from './controls';
import { ModPanel } from './modPanel';
import {
  applyFxPreset, binauralPage, binOf, canEnableFormula, checkPattern, coreSchema, couplingControls, couplingValue, filterControls,
  fxCards, fxChoiceValue, fxFlag, fxNumber, fxPresets, layerOf, layersPage, modulatedKeys, setFxChoice,
  setFxFlag, setFxNumber, soundMode, soundName, vowelLabel, writableBin, writableLayer,
} from './settingsModel';
import type { SeqLayer } from '../state/types';
import type { FxChoiceKey, FxNumKey } from './settingsModel';

export type SettingsTab = 'audio' | 'video';

function choiceKey(k: string): FxChoiceKey {
  return k === 'chorusMode' || k === 'phaserStages' ? k : 'filterType';
}

export interface SettingsHandlers {
  /** Something audible changed (formulas, effects, LFOs, routes to sound). */
  onSound(): void;
  onVolume(v: number): void;
  onSoundToggle(): void;
  onClose(): void;
}

export interface SettingsElements {
  root: HTMLElement;
  tabAudio: HTMLButtonElement;
  tabVideo: HTMLButtonElement;
  paneAudio: HTMLElement;
  paneVideo: HTMLElement;
  closeBtn: HTMLButtonElement;
  soundBtn: HTMLButtonElement;
}

function section(pane: HTMLElement, title: string, hint?: string): HTMLElement {
  const head = make('div', 'settings-head');
  head.appendChild(make('h2', undefined, title));
  if (hint) head.appendChild(make('span', 'settings-hint', hint));
  pane.appendChild(head);
  return head;
}

/** A line of text with a check under it: the layer's pattern. `set` returns
 *  "" when the text was taken, else what is wrong with it. */
function textRow(o: {
  id: string; label: string; placeholder: string; get(): string; set(v: string): string;
}): { row: HTMLElement; input: HTMLInputElement; sync(): void } {
  const row = make('div', 'ctrl ctrl-select ctrl-text');
  const label = make('label', undefined, o.label);
  label.htmlFor = o.id;
  const input = make('input');
  input.type = 'text';
  input.id = o.id;
  input.placeholder = o.placeholder;
  input.spellcheck = false;
  input.autocomplete = 'off';
  const error = make('div', 'ctrl-error');
  input.addEventListener('input', () => {
    const e = o.set(input.value);
    error.textContent = e;
    input.classList.toggle('invalid', e !== '');
  });
  row.append(label, input, error);
  const sync = (): void => {
    input.value = o.get();
    error.textContent = '';
    input.classList.remove('invalid');
  };
  return { row, input, sync };
}

type LayerNumber = 'gain' | 'speed' | 'density' | 'humanize' | 'az';
const isLayerNumber = (k: string): k is LayerNumber =>
  k === 'gain' || k === 'speed' || k === 'density' || k === 'humanize' || k === 'az';

/** A switch as a row: label, checkbox. */
function checkRow(o: { id: string; label: string; get(): boolean; set(v: boolean): void }): {
  row: HTMLElement; sync(): void;
} {
  const row = make('div', 'ctrl ctrl-select');
  const label = make('label', undefined, o.label);
  label.htmlFor = o.id;
  const input = make('input');
  input.type = 'checkbox';
  input.id = o.id;
  input.addEventListener('change', () => o.set(input.checked));
  row.append(label, input);
  return { row, sync: () => { input.checked = o.get(); } };
}

function grid(pane: HTMLElement): HTMLElement {
  const g = make('div', 'settings-grid');
  pane.appendChild(g);
  return g;
}

export class SettingsPage {
  private draft: AppState | null = null;
  private volume = 0.75;
  private readonly els: SettingsElements;
  private readonly handlers: SettingsHandlers;
  private readonly formulaCards: Card[] = [];
  private readonly syncs: (() => void)[] = [];
  private readonly soundMod: ModPanel;
  private readonly videoMod: ModPanel;
  private readonly soundNote: HTMLElement;
  private readonly fxPreset: HTMLSelectElement;
  private volumeSync: () => void = () => {};
  private tab: SettingsTab = 'audio';
  private allOpen = false;

  constructor(els: SettingsElements, handlers: SettingsHandlers) {
    this.els = els;
    this.handlers = handlers;
    this.soundNote = make('p', 'settings-note');
    this.fxPreset = make('select');
    this.soundMod = new ModPanel({
      domain: 'sound', id: 'setSm', state: () => this.state,
      onChange: () => this.modChanged(true),
    });
    this.videoMod = new ModPanel({
      domain: 'picture', id: 'setVm', state: () => this.state,
      // an LFO is shared: moving one is heard even from the Video tab
      onChange: (kind) => this.modChanged(kind === 'lfo'),
    });
    this.buildAudio();
    this.buildVideo();
    setupAdjustmentButtons(els.paneAudio);
    setupAdjustmentButtons(els.paneVideo);
    els.tabAudio.addEventListener('click', () => this.showTab('audio'));
    els.tabVideo.addEventListener('click', () => this.showTab('video'));
    els.closeBtn.addEventListener('click', () => handlers.onClose());
    els.soundBtn.addEventListener('click', () => handlers.onSoundToggle());
  }

  get isOpen(): boolean {
    return !this.els.root.hidden;
  }

  /** Shows the page editing `state` in place. */
  open(state: AppState, volume: number, soundRunning: boolean): void {
    this.draft = state;
    this.volume = volume;
    this.fxPreset.value = '';
    this.syncAll();
    this.setSoundRunning(soundRunning);
    this.els.root.hidden = false;
    this.showTab(this.tab);
    // keyboard focus moves into the page (it stayed on the ⚙ button, now covered)
    (this.tab === 'audio' ? this.els.tabAudio : this.els.tabVideo).focus();
  }

  hide(): void {
    this.els.root.hidden = true;
    this.draft = null;
  }

  setSoundRunning(running: boolean): void {
    this.soundNote.textContent = running
      ? 'Changes here are heard as you make them. Closing the settings makes this point one step — ↩ Undo takes it back.'
      : 'Sound is off — press ▶ Sound to hear your changes as you make them. Closing the settings makes this point one step — ↩ Undo takes it back.';
  }

  setVolume(v: number): void {
    this.volume = v;
    this.volumeSync();
  }

  private get state(): AppState {
    if (!this.draft) throw new Error('settings: no point is open');
    return this.draft;
  }

  private showTab(tab: SettingsTab): void {
    this.tab = tab;
    const audio = tab === 'audio';
    this.els.tabAudio.setAttribute('aria-selected', String(audio));
    this.els.tabVideo.setAttribute('aria-selected', String(!audio));
    this.els.paneAudio.hidden = !audio;
    this.els.paneVideo.hidden = audio;
    // the LFOs are shared: the other tab may have moved them
    (audio ? this.soundMod : this.videoMod).sync();
  }

  private syncAll(): void {
    for (const s of this.syncs) s();
    this.volumeSync();
    this.soundMod.sync();
    this.videoMod.sync();
    this.showModulated();
  }

  private sound(): void {
    this.handlers.onSound();
  }

  private modChanged(heard: boolean): void {
    this.showModulated();
    if (heard) this.sound();
  }

  /** ∿ on every slider an LFO route currently moves. */
  private showModulated(): void {
    const keys = modulatedKeys(this.state.mod.routes);
    for (const pane of [this.els.paneAudio, this.els.paneVideo]) {
      for (const row of pane.querySelectorAll<HTMLElement>('.ctrl[data-mod]')) {
        row.classList.toggle('modulated', keys.has(row.dataset.mod ?? ''));
      }
    }
  }

  // --- Audio (formula-synth) -------------------------------------------------

  private buildAudio(): void {
    const pane = this.els.paneAudio;
    pane.appendChild(this.soundNote);

    const master = sliderRow({
      id: 'setVolume',
      label: 'Master volume',
      scale: { min: 0, max: 1, step: 0.01 },
      get: () => this.volume,
      set: (v) => { this.volume = v; this.handlers.onVolume(v); },
    });
    master.row.classList.add('settings-master');
    pane.appendChild(master.row);
    this.volumeSync = master.sync;

    const { formulas: FORMULAS, maxEnabledFormulas: MAX_ENABLED_FORMULAS } = coreSchema();
    const head = section(pane, 'Formulas', `up to ${MAX_ENABLED_FORMULAS} at once`);
    const offAll = make('button', 'mini-btn', 'Switch all off');
    offAll.type = 'button';
    offAll.id = 'setFormulasOff';
    offAll.addEventListener('click', () => {
      for (const f of FORMULAS) this.state.audio.formulas[f.id].enabled = false;
      for (const c of this.formulaCards) c.sync();
      this.soundMod.sync();
      this.sound();
    });
    const expand = make('button', 'mini-btn', 'Expand all');
    expand.type = 'button';
    expand.addEventListener('click', () => {
      this.allOpen = !this.allOpen;
      for (const c of this.formulaCards) c.setOpen(this.allOpen);
      expand.textContent = this.allOpen ? 'Collapse all' : 'Expand all';
    });
    head.append(offAll, expand);

    const formulas = grid(pane);
    for (const f of FORMULAS) {
      const snap = () => this.state.audio.formulas[f.id];
      const c = card({
        id: `setF_${f.id}`,
        title: f.title,
        tag: f.tag,
        desc: f.desc,
        toggle: {
          get: () => snap().enabled,
          set: (on) => {
            snap().enabled = on;
            // the cap may have changed for every other card
            for (const other of this.formulaCards) other.refresh();
            this.soundMod.sync(); // routes may now aim at it
            this.sound();
          },
          allowed: () => canEnableFormula(this.state, f.id),
          blockedTitle: `Up to ${MAX_ENABLED_FORMULAS} formulas at once — switch one off first`,
        },
      });
      for (const s of f.sliders) {
        const row = sliderRow({
          id: `setA_${f.id}_${s.k}`,
          label: s.name,
          scale: s,
          get: () => snap().params[s.k] ?? s.value,
          set: (v) => { snap().params[s.k] = v; this.sound(); },
          modKey: `${f.id}.${s.k}`,
        });
        c.body.appendChild(row.row);
        this.syncs.push(row.sync);
      }
      this.formulaCards.push(c);
      this.syncs.push(c.sync);
      formulas.appendChild(c.root);
    }

    this.buildLayers(pane);

    const fxHead = section(pane, 'Effects', 'the chain runs left to right, top to bottom');
    const presetLab = make('label', 'settings-preset', 'Preset ');
    this.fxPreset.id = 'setFxPreset';
    fillSelect(this.fxPreset, [
      { value: '', label: '— configure one effect —' },
      ...fxPresets().map((p, i) => ({ value: String(i), label: p.name, group: p.group })),
    ]);
    presetLab.appendChild(this.fxPreset);
    fxHead.appendChild(presetLab);
    const fxGrid = grid(pane);
    const fxSyncs: (() => void)[] = [];
    this.fxPreset.addEventListener('change', () => {
      if (this.fxPreset.value === '') return;
      Object.assign(this.state.audio.fx, applyFxPreset(this.state.audio.fx, Number(this.fxPreset.value)));
      for (const s of fxSyncs) s();
      this.sound();
    });
    // touching any effect by hand makes it no longer "that preset"
    const fxEdited = (): void => {
      this.fxPreset.value = '';
      this.sound();
    };

    for (const spec of fxCards()) {
      const fx = () => this.state.audio.fx;
      const c = card({
        id: `setFx_${spec.on}`,
        title: spec.title,
        tag: spec.tag,
        toggle: { get: () => fxFlag(fx(), spec.on), set: (on) => { setFxFlag(fx(), spec.on, on); fxEdited(); } },
      });
      const rows = new Map<FxNumKey, ReturnType<typeof sliderRow>>();
      for (const ch of spec.choices) {
        const row = selectRow({
          id: `setFx_${ch.k}`,
          label: ch.name,
          options: ch.options,
          get: () => fxChoiceValue(fx(), choiceKey(ch.k)),
          set: (v) => {
            setFxChoice(fx(), choiceKey(ch.k), v);
            if (ch.k === 'filterType') showFilterRows();
            fxEdited();
          },
        });
        c.body.appendChild(row.row);
        fxSyncs.push(row.sync);
      }
      for (const s of spec.sliders) {
        const row = sliderRow({
          id: `setFx_${s.k}`,
          label: s.name,
          scale: s,
          get: () => fxNumber(fx(), s.k),
          set: (v) => { setFxNumber(fx(), s.k, v); fxEdited(); },
          format: s.k === 'filterVowel' ? vowelLabel : undefined,
          modKey: s.k === 'reverbDecay' ? undefined : `fx.${s.k}`,
        });
        rows.set(s.k, row);
        c.body.appendChild(row.row);
        fxSyncs.push(row.sync);
      }
      // The filter shows only the rows its type uses, named for what they do.
      const showFilterRows = (): void => {
        if (spec.on !== 'filterOn') return;
        const fc = filterControls(fx().filterType);
        rows.get('filterFreq')?.setLabel(fc.freqLabel);
        rows.get('filterQ')?.setLabel(fc.qLabel);
        const show = (k: FxNumKey, on: boolean): void => {
          const r = rows.get(k);
          if (r) r.row.hidden = !on;
        };
        show('filterQ', fc.q);
        show('filterGain', fc.gain);
        show('filterVowel', fc.vowel);
        show('filterCombFb', fc.comb);
      };
      fxSyncs.push(c.sync, showFilterRows);
      fxGrid.appendChild(c.root);
    }
    this.syncs.push(...fxSyncs);

    this.buildBinaural(pane);

    section(pane, 'Modulation', 'LFOs → sound parameters');
    pane.appendChild(this.soundMod.root);
  }

  /** The sample and drum layers: recordings and drums over the formulas, in
   *  rhythms of Strudel's mini-notation (synesthesia-core
   *  PLAN-SAMPLES-SCRIPTS.md). They go into the effects with the formulas,
   *  so the section sits between the two. */
  private buildLayers(pane: HTMLElement): void {
    const schema = coreSchema();
    const page = layersPage();
    section(pane, 'Layers', 'recorded sounds and drums, in rhythms you can write');
    const layers = grid(pane);

    const tempo = card({ id: 'setLayers', title: 'Tempo', tag: 'all layers', desc: schema.seqDescription });
    const cps = sliderRow({
      id: 'setL_cps',
      label: page.tempo.name,
      scale: page.tempo,
      get: () => this.state.seq?.cps ?? 0.5,
      set: (v) => {
        this.state.seq ??= { cps: v, layers: [] };
        this.state.seq.cps = v;
        this.sound();
      },
      modKey: 'seq.cps',
    });
    tempo.body.appendChild(cps.row);
    this.syncs.push(cps.sync, tempo.sync);
    layers.appendChild(tempo.root);

    const sounds = page.soundGroups.flatMap((g) => g.names.map((n) => ({ value: n, label: n, group: g.group })));
    const rhythms = [
      ...schema.seqRhythms.slice(1).map((r) => ({ value: r, label: r })),
      { value: '', label: page.customRhythm },
    ];
    for (let i = 0; i < schema.seqLayers; i++) {
      const get = (): SeqLayer => layerOf(this.state, i);
      const set = (f: (l: SeqLayer) => void): void => {
        f(writableLayer(this.state, i));
        this.sound();
      };
      const c = card({
        id: `setL_${i}`,
        title: `Layer ${i + 1}`,
        desc: schema.seqLayerDescription,
        toggle: {
          get: () => get().on,
          set: (on) => {
            set((l) => {
              l.on = on;
              // a slot used for the first time: something to hear at once
              if (on && !l.sound) {
                l.sound = schema.seqSounds[0].name;
                l.mode = soundMode(l.sound);
              }
              if (on && !l.pattern) l.pattern = schema.seqRhythms[1];
            });
            syncLayer();
            this.soundMod.sync(); // routes may now aim at it
          },
        },
      });
      const sound = selectRow({
        id: `setL_${i}_sound`,
        label: 'Sound',
        options: sounds,
        get: () => soundName(get().sound),
        set: (v) => {
          // a bed is a bed: crickets loop, an owl calls
          set((l) => { l.sound = v; l.mode = soundMode(v); });
          mode.sync();
          showForMode();
        },
      });
      const mode = selectRow({
        id: `setL_${i}_mode`,
        label: 'Plays as',
        options: page.modes,
        get: () => get().mode,
        set: (v) => {
          set((l) => { l.mode = v === 'bed' ? 'bed' : 'hits'; });
          showForMode();
        },
      });
      const rhythm = selectRow({
        id: `setL_${i}_rhythm`,
        label: 'Rhythm',
        options: rhythms,
        get: () => (schema.seqRhythms.indexOf(get().pattern) > 0 ? get().pattern : ''),
        set: (v) => {
          if (v === '') {
            pattern.input.focus();
            return;
          }
          set((l) => { l.pattern = v; });
          pattern.sync();
        },
      });
      const pattern = textRow({
        id: `setL_${i}_pattern`,
        label: 'Pattern',
        placeholder: 'e.g. 0 ~ [0 1] ~ , hh*8?',
        get: () => get().pattern,
        // a pattern that does not parse is shown, not applied
        set: (v) => {
          const error = checkPattern(v);
          if (error === '') {
            set((l) => { l.pattern = v; });
            rhythm.sync();
          }
          return error;
        },
      });
      c.body.append(sound.row, mode.row, rhythm.row, pattern.row);
      const rows = [sound.sync, mode.sync, rhythm.sync, pattern.sync];
      // a bed loops under everything: no rhythm, no pattern, no density
      const forHits: HTMLElement[] = [rhythm.row, pattern.row];
      const showForMode = (): void => {
        for (const r of forHits) r.hidden = get().mode === 'bed';
      };
      for (const s of page.sliders) {
        const key = s.k;
        if (!isLayerNumber(key)) continue;
        const row = sliderRow({
          id: `setL_${i}_${key}`,
          label: s.name,
          scale: s,
          get: () => get()[key] ?? 0,
          set: (v) => set((l) => { l[key] = v; }),
          modKey: key === 'humanize' ? undefined : `seq.${i}.${key}`,
        });
        c.body.appendChild(row.row);
        rows.push(row.sync);
        if (key === 'density') forHits.push(row.row);
      }
      const dry = checkRow({
        id: `setL_${i}_dry`,
        label: 'Past the effects',
        get: () => get().dry,
        set: (v) => set((l) => { l.dry = v; }),
      });
      c.body.appendChild(dry.row);
      rows.push(dry.sync, showForMode);
      const syncLayer = (): void => { for (const s of rows) s(); };
      this.syncs.push(syncLayer, c.sync);
      layers.appendChild(c.root);
    }
  }

  /** Space and the binaural beat (synesthesia-core PLAN-BINAURAL.md): the
   *  width that spreads every voice by its azimuth, and the beat between the
   *  ears. After the effects: the beat shifts the whole mix, reverb and all. */
  private buildBinaural(pane: HTMLElement): void {
    const page = binauralPage();
    section(pane, 'Space', 'where the voices sit, and a beat between the ears');
    const g = grid(pane);
    const c = card({ id: 'setBin', title: page.title, tag: page.tag, desc: coreSchema().binDescription });
    const set = (f: (b: ReturnType<typeof writableBin>) => void): void => {
      f(writableBin(this.state));
      this.sound();
    };
    const width = sliderRow({
      id: 'setBin_width',
      label: page.width.name,
      scale: page.width,
      get: () => binOf(this.state).width,
      set: (v) => set((b) => { b.width = v; }),
      modKey: 'bin.width',
    });
    const on = checkRow({
      id: 'setBin_on',
      label: page.on,
      get: () => binOf(this.state).on,
      set: (v) => {
        set((b) => { b.on = v; });
        showBeat();
      },
    });
    const beat = sliderRow({
      id: 'setBin_beat',
      label: page.beat.name,
      scale: page.beat,
      get: () => binOf(this.state).beat,
      set: (v) => set((b) => { b.beat = v; }),
      modKey: 'bin.beat',
    });
    // the beat's rate means nothing while the beat is off
    const showBeat = (): void => { beat.row.hidden = !binOf(this.state).on; };
    c.body.append(width.row, on.row, beat.row);
    this.syncs.push(width.sync, on.sync, beat.sync, showBeat, c.sync);
    g.appendChild(c.root);
  }

  // --- Video (chromaflux) ------------------------------------------------------

  private buildVideo(): void {
    const pane = this.els.paneVideo;
    pane.appendChild(make('p', 'settings-note',
      'The picture is paused while the settings are open: what you change here shows when you close them. Closing makes this point one step — ↩ Undo takes it back.'));

    section(pane, 'Image', 'reaction–diffusion, flow and colour');
    const cards = grid(pane);
    const { cards: CARDS, alwaysOnCardIds } = coreSchema();
    for (const def of CARDS) {
      const cs = () => this.state.visual.cards[def.id];
      const alwaysOn = alwaysOnCardIds.some((id) => id === def.id);
      const c = card({
        id: `setV_${def.id}`,
        title: def.title,
        tag: def.tag,
        desc: def.desc,
        toggle: alwaysOn ? undefined : {
          get: () => cs().on,
          set: (on) => { cs().on = on; this.videoMod.sync(); },
        },
      });
      for (const sel of def.selects ?? []) {
        const row = selectRow({
          id: `setV_${def.id}_${sel.k}`,
          label: sel.name,
          options: sel.options.map((o) => ({ value: String(o.v), label: o.label })),
          get: () => String(cs().params[sel.k]),
          set: (v) => { cs().params[sel.k] = Number(v); },
        });
        c.body.appendChild(row.row);
        this.syncs.push(row.sync);
      }
      for (const s of def.sliders) {
        const row = sliderRow({
          id: `setV_${def.id}_${s.k}`,
          label: s.name,
          scale: s,
          get: () => cs().params[s.k],
          set: (v) => { cs().params[s.k] = v; },
          modKey: `${def.id}.${s.k}`,
        });
        c.body.appendChild(row.row);
        this.syncs.push(row.sync);
      }
      this.syncs.push(c.sync);
      cards.appendChild(c.root);
    }

    section(pane, 'Sound → image', 'how the picture listens');
    const links = grid(pane);
    const groups = [
      { kind: 'offset', title: 'Nudges', tag: '−1 … +1', desc: 'Loudness, brightness and hits push one picture parameter each, every frame. Negative pushes the other way.' },
      { kind: 'effect', title: 'Effects', tag: '0 … 1', desc: 'Pulse, flash, new growth on every hit, and colour from bass / mid / treble. 👍/👎 keep these four at 1.2 or more in total, so the link never goes mute.' },
    ] as const;
    for (const g of groups) {
      const c = card({ id: `setC_${g.kind}`, title: g.title, tag: g.tag, desc: g.desc });
      for (const ctl of couplingControls().filter((x) => x.kind === g.kind)) {
        const row = sliderRow({
          id: `setC_${ctl.k}`,
          label: ctl.name,
          scale: ctl,
          get: () => couplingValue(this.state.coupling, ctl.k),
          set: (v) => { Reflect.set(this.state.coupling, ctl.k, v); },
        });
        row.row.classList.add('wide-label');
        c.body.appendChild(row.row);
        this.syncs.push(row.sync);
      }
      links.appendChild(c.root);
    }

    section(pane, 'Modulation', 'LFOs → picture parameters');
    pane.appendChild(this.videoMod.root);
  }
}
