// Audio engine: AudioContext, worklet generators, FX chain, analyser. No DOM
// — takes ready state (schema/audio.ts), the app calls methods. Ported from
// formula-synth (recorder dropped; the analyser feeds src/audio/features.ts).
import workletUrl from '../worklet/processors.ts?worker&url';
import { FORMULAS } from '../schema/audio';
import type { FxState } from '../schema/audio';
import type { Params } from '../dsp/generator';
import type { ModRoute, ModState } from '../dsp/mod';
import { clampNum, filterMode, toBiquadType, vowelFormants } from './filters';
import { buildModPayload, modulateFx } from './modrouting';
import type { ModPayload } from './modrouting';

export interface FormulaSetting {
  enabled: boolean;
  params: Params;
}

export interface EngineState {
  masterGain: number;
  fx: FxState;
  formulas: Record<string, FormulaSetting>;
  mod?: ModState;
}

interface FormulaNodes {
  aw: AudioWorkletNode;
  g: GainNode;
}

const GAIN_SMOOTH = 0.02;      // s — generator on/off smoothing
const PARAM_SMOOTH = 0.05;     // s — gain changes during morphs
const FX_MOD_INTERVAL_MS = 25; // ~40 Hz control rate for LFO → FX
const FX_SMOOTH_TC = 0.03;     // s — smoothing of modulated FX params

function makeImpulseResponse(ctx: AudioContext, seconds: number, decay: number): AudioBuffer {
  const sr = ctx.sampleRate;
  const len = Math.max(1, Math.floor(sr * seconds));
  const buf = ctx.createBuffer(2, len, sr);
  for (let ch = 0; ch < 2; ch++) {
    const data = buf.getChannelData(ch);
    for (let i = 0; i < len; i++) {
      const t = i / sr;
      const env = Math.exp(-t / Math.max(1e-3, decay));
      data[i] = (Math.random() * 2 - 1) * env;
    }
  }
  return buf;
}

export class AudioEngine {
  private ctx: AudioContext | null = null;
  private analyserNode: AnalyserNode | null = null;

  private mixBus!: GainNode;
  private master!: GainNode;

  private filterNode!: BiquadFilterNode;
  private formantBands: BiquadFilterNode[] = [];
  private formantGains: GainNode[] = [];
  private formantSum!: GainNode;
  private combInput!: GainNode;
  private combDelay!: DelayNode;
  private combFb!: GainNode;

  private chorusDelay!: DelayNode;
  private chorusLFO!: OscillatorNode;
  private chorusLFOGain!: GainNode;
  private chorusDry!: GainNode;
  private chorusWet!: GainNode;
  private chorusFb!: GainNode;
  private chorusSum!: GainNode;

  private reverbConv!: ConvolverNode;
  private reverbDry!: GainNode;
  private reverbWet!: GainNode;
  private reverbSum!: GainNode;
  private lastReverbDecay = NaN;

  private limiter!: DynamicsCompressorNode;

  private delayNode!: DelayNode;
  private delayDry!: GainNode;
  private delayWet!: GainNode;
  private delayFb!: GainNode;
  private delaySum!: GainNode;

  private phaserFilters: BiquadFilterNode[] = [];
  private phaserLFO!: OscillatorNode;
  private phaserLFOGains: GainNode[] = [];
  private phaserDry!: GainNode;
  private phaserWet!: GainNode;
  private phaserFb!: GainNode;
  private phaserInput!: GainNode;
  private phaserOutput!: GainNode;
  private phaserSum!: GainNode;
  private phaserStagesConnected = 0;

  private nodes = new Map<string, FormulaNodes>();
  private enabledMap = new Map<string, boolean>();

  private modState: ModState | null = null;

  // FX modulation runs on the main thread at control rate. baseFx = slider
  // values; the timer overlays modulated fields on top.
  private baseFx: FxState | null = null;
  private routingKey = '';
  private startTime = 0;
  private fxModTimer: ReturnType<typeof setInterval> | null = null;

  get running(): boolean {
    return this.ctx !== null;
  }

  get analyser(): AnalyserNode | null {
    return this.analyserNode;
  }

  get sampleRate(): number {
    return this.ctx ? this.ctx.sampleRate : 48000;
  }

  /** Seconds since start — the LFO clock shared with the visual loop. */
  get time(): number {
    return this.ctx ? this.ctx.currentTime - this.startTime : 0;
  }

  async resume(): Promise<void> {
    if (this.ctx && this.ctx.state === 'suspended') await this.ctx.resume();
  }

  async start(state: EngineState): Promise<void> {
    if (this.ctx) return;

    const ctx = new AudioContext({ latencyHint: 'interactive' });
    if (ctx.state === 'suspended') await ctx.resume();
    await ctx.audioWorklet.addModule(workletUrl);
    this.ctx = ctx;

    this.analyserNode = ctx.createAnalyser();
    this.analyserNode.fftSize = 2048;
    this.analyserNode.smoothingTimeConstant = 0.5;

    this.mixBus = ctx.createGain();
    this.mixBus.gain.value = 1;

    this.filterNode = ctx.createBiquadFilter();
    this.formantBands = [];
    this.formantGains = [];
    this.formantSum = ctx.createGain();
    for (let i = 0; i < 3; i++) {
      const band = ctx.createBiquadFilter();
      band.type = 'bandpass';
      this.formantBands.push(band);
      this.formantGains.push(ctx.createGain());
    }
    this.combInput = ctx.createGain();
    this.combDelay = ctx.createDelay(0.05);
    this.combFb = ctx.createGain();

    this.chorusDelay = ctx.createDelay(0.2);
    this.chorusDry = ctx.createGain();
    this.chorusWet = ctx.createGain();
    this.chorusFb = ctx.createGain();
    this.chorusSum = ctx.createGain();
    this.chorusLFO = ctx.createOscillator();
    this.chorusLFOGain = ctx.createGain();
    this.chorusLFO.connect(this.chorusLFOGain);
    this.chorusLFOGain.connect(this.chorusDelay.delayTime);
    this.chorusLFO.start();

    this.reverbConv = ctx.createConvolver();
    this.reverbDry = ctx.createGain();
    this.reverbWet = ctx.createGain();
    this.reverbSum = ctx.createGain();
    this.lastReverbDecay = NaN;

    this.limiter = ctx.createDynamicsCompressor();

    this.delayNode = ctx.createDelay(3.0);
    this.delayDry = ctx.createGain();
    this.delayWet = ctx.createGain();
    this.delayFb = ctx.createGain();
    this.delaySum = ctx.createGain();

    const numPhaserStages = 8;
    this.phaserFilters = [];
    this.phaserLFOGains = [];
    this.phaserLFO = ctx.createOscillator();
    this.phaserLFO.type = 'sine';
    this.phaserLFO.start();
    for (let i = 0; i < numPhaserStages; i++) {
      const filter = ctx.createBiquadFilter();
      filter.type = 'allpass';
      filter.frequency.value = 1000;
      filter.Q.value = 0.5;
      this.phaserFilters.push(filter);

      const lfoGain = ctx.createGain();
      lfoGain.gain.value = 1500;
      this.phaserLFO.connect(lfoGain);
      lfoGain.connect(filter.frequency);
      this.phaserLFOGains.push(lfoGain);
    }
    this.phaserDry = ctx.createGain();
    this.phaserWet = ctx.createGain();
    this.phaserFb = ctx.createGain();
    this.phaserInput = ctx.createGain();
    this.phaserOutput = ctx.createGain();
    this.phaserSum = ctx.createGain();

    this.master = ctx.createGain();
    this.master.gain.value = state.masterGain;

    this.startTime = ctx.currentTime;
    this.modState = state.mod ?? null;
    this.applyFx(state.fx);

    for (const f of FORMULAS) {
      const setting = state.formulas[f.id];
      const params: Params = setting ? { ...setting.params } : {};
      const enabled = setting ? setting.enabled : false;
      const aw = new AudioWorkletNode(ctx, 'formula-generator', {
        numberOfInputs: 0,
        numberOfOutputs: 1,
        outputChannelCount: [1],
        processorOptions: {
          formula: f.id, params, enabled,
          mod: this.modPayloadFor(f.id),
        },
      });
      const g = ctx.createGain();
      g.gain.value = 0;
      aw.connect(g);
      g.connect(this.mixBus);
      this.nodes.set(f.id, { aw, g });
      this.enabledMap.set(f.id, enabled);

      if (setting) {
        const gain = typeof params.gain === 'number' ? params.gain : 0;
        g.gain.setTargetAtTime(enabled ? gain : 0, ctx.currentTime, GAIN_SMOOTH);
      }
    }
  }

  /** Fades the master out and closes the context. */
  async stop(): Promise<void> {
    const ctx = this.ctx;
    if (!ctx) return;
    this.stopFxModTimer();
    this.master.gain.setTargetAtTime(0, ctx.currentTime, 0.01);
    await new Promise((r) => setTimeout(r, 80));
    try { this.chorusLFO.stop(); } catch { /* already stopped */ }
    try { this.phaserLFO.stop(); } catch { /* already stopped */ }
    await ctx.close();
    this.ctx = null;
    this.analyserNode = null;
    this.nodes.clear();
    this.enabledMap.clear();
    this.routingKey = '';
  }

  setMasterGain(v: number): void {
    if (this.ctx) this.master.gain.setTargetAtTime(v, this.ctx.currentTime, PARAM_SMOOTH);
  }

  /** Full FX application: routing (only if the on/type/stage set changed) + params (+ mod timer). */
  applyFx(fx: FxState): void {
    if (!this.ctx) return;
    this.baseFx = fx;
    const key = [fx.filterOn, fx.filterType, fx.chorusOn, fx.phaserOn, fx.phaserStages, fx.delayOn, fx.reverbOn, fx.limiterOn].join('|');
    if (key !== this.routingKey) {
      this.routingKey = key;
      this.applyRouting(fx);
    }
    this.updateFxMod();
  }

  private fxRoutes(): ModRoute[] {
    return (this.modState?.routes ?? []).filter((r) => r.target === 'fx');
  }

  private stopFxModTimer(): void {
    if (this.fxModTimer !== null) {
      clearInterval(this.fxModTimer);
      this.fxModTimer = null;
    }
  }

  private updateFxMod(): void {
    if (!this.ctx || !this.baseFx) return;
    if (this.fxRoutes().length > 0) {
      if (this.fxModTimer === null) {
        this.fxModTimer = setInterval(() => this.tickFxMod(), FX_MOD_INTERVAL_MS);
      }
      this.tickFxMod();
    } else {
      this.stopFxModTimer();
      this.applyFxParams(this.baseFx);
    }
  }

  private tickFxMod(): void {
    const ctx = this.ctx;
    if (!ctx || !this.baseFx || !this.modState) return;
    const t = ctx.currentTime - this.startTime;
    const eff = modulateFx(this.baseFx, this.fxRoutes(), this.modState.lfos, t);
    this.applyFxParams(eff);
  }

  private applyRouting(fx: FxState): void {
    const ctx = this.ctx;
    if (!ctx || !this.analyserNode) return;

    this.mixBus.disconnect();
    this.filterNode.disconnect();
    for (const b of this.formantBands) b.disconnect();
    for (const g of this.formantGains) g.disconnect();
    this.formantSum.disconnect();
    this.combInput.disconnect(); this.combDelay.disconnect(); this.combFb.disconnect();

    this.chorusDry.disconnect(); this.chorusWet.disconnect();
    this.chorusDelay.disconnect(); this.chorusFb.disconnect();
    this.chorusSum.disconnect();

    this.reverbDry.disconnect(); this.reverbWet.disconnect();
    this.reverbConv.disconnect(); this.reverbSum.disconnect();

    this.limiter.disconnect();

    this.delayNode.disconnect(); this.delayDry.disconnect();
    this.delayWet.disconnect(); this.delayFb.disconnect();
    this.delaySum.disconnect();

    this.phaserDry.disconnect(); this.phaserWet.disconnect();
    this.phaserInput.disconnect(); this.phaserOutput.disconnect();
    this.phaserFb.disconnect(); this.phaserSum.disconnect();
    for (const f of this.phaserFilters) f.disconnect();

    this.master.disconnect();
    this.analyserNode.disconnect();

    this.analyserNode.connect(ctx.destination);

    let node: AudioNode = this.mixBus;

    if (fx.filterOn) {
      const mode = filterMode(fx.filterType);
      if (mode === 'formant') {
        for (let i = 0; i < this.formantBands.length; i++) {
          node.connect(this.formantBands[i]);
          this.formantBands[i].connect(this.formantGains[i]);
          this.formantGains[i].connect(this.formantSum);
        }
        node = this.formantSum;
      } else if (mode === 'comb') {
        node.connect(this.combInput);
        this.combInput.connect(this.combDelay);
        this.combDelay.connect(this.combFb);
        this.combFb.connect(this.combInput);
        node = this.combDelay;
      } else {
        node.connect(this.filterNode);
        node = this.filterNode;
      }
    }

    if (fx.chorusOn) {
      node.connect(this.chorusDry);
      node.connect(this.chorusDelay);
      this.chorusDelay.connect(this.chorusFb);
      this.chorusFb.connect(this.chorusDelay);
      this.chorusDelay.connect(this.chorusWet);
      this.chorusDry.connect(this.chorusSum);
      this.chorusWet.connect(this.chorusSum);
      node = this.chorusSum;
    }

    if (fx.phaserOn) {
      node.connect(this.phaserDry);
      node.connect(this.phaserInput);
      const stages = Math.max(1, Math.min(this.phaserFilters.length, Math.floor(fx.phaserStages)));
      this.phaserStagesConnected = stages;
      let pNode: AudioNode = this.phaserInput;
      for (let i = 0; i < stages; i++) {
        pNode.connect(this.phaserFilters[i]);
        pNode = this.phaserFilters[i];
      }
      pNode.connect(this.phaserOutput);
      this.phaserOutput.connect(this.phaserFb);
      this.phaserFb.connect(this.phaserInput);
      this.phaserOutput.connect(this.phaserWet);
      this.phaserDry.connect(this.phaserSum);
      this.phaserWet.connect(this.phaserSum);
      node = this.phaserSum;
    }

    if (fx.delayOn) {
      node.connect(this.delayDry);
      node.connect(this.delayNode);
      this.delayNode.connect(this.delayFb);
      this.delayFb.connect(this.delayNode);
      this.delayNode.connect(this.delayWet);
      this.delayDry.connect(this.delaySum);
      this.delayWet.connect(this.delaySum);
      node = this.delaySum;
    }

    if (fx.reverbOn) {
      node.connect(this.reverbDry);
      node.connect(this.reverbConv);
      this.reverbConv.connect(this.reverbWet);
      this.reverbDry.connect(this.reverbSum);
      this.reverbWet.connect(this.reverbSum);
      node = this.reverbSum;
    }

    if (fx.limiterOn) {
      node.connect(this.limiter);
      node = this.limiter;
    }

    node.connect(this.master);
    this.master.connect(this.analyserNode);
  }

  applyFxParams(fx: FxState): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const now = ctx.currentTime;

    // Values arrive at control rate during modulation AND during genome
    // morphs, so always smooth: setValueAtTime would zipper/click, which the
    // phaser's feedback loop rings on.
    const set = (p: AudioParam, v: number): void => {
      p.setTargetAtTime(v, now, FX_SMOOTH_TC);
    };

    const fmode = filterMode(fx.filterType);
    if (fmode === 'biquad') {
      this.filterNode.type = toBiquadType(fx.filterType);
      set(this.filterNode.frequency, clampNum(fx.filterFreq, 20, 20000));
      set(this.filterNode.Q, fx.filterQ);
      set(this.filterNode.gain, fx.filterGain);
    } else if (fmode === 'formant') {
      const { f, a } = vowelFormants(fx.filterVowel);
      const scale = clampNum(fx.filterFreq, 200, 4000) / 1000;
      const q = clampNum(fx.filterQ * 6, 4, 28);
      for (let i = 0; i < this.formantBands.length; i++) {
        set(this.formantBands[i].frequency, clampNum(f[i] * scale, 50, 8000));
        set(this.formantBands[i].Q, q);
        set(this.formantGains[i].gain, a[i]);
      }
    } else {
      const freq = clampNum(fx.filterFreq, 20, 2000);
      set(this.combDelay.delayTime, 1 / freq);
      set(this.combFb.gain, clampNum(fx.filterCombFb, 0, 0.95));
    }

    const baseMs = fx.chorusMode === 'flanger' ? 2.0 : 12.0;
    set(this.chorusDelay.delayTime, baseMs / 1000);
    set(this.chorusLFO.frequency, fx.chorusRate);
    set(this.chorusLFOGain.gain, fx.chorusDepth / 1000);
    set(this.chorusDry.gain, 1 - fx.chorusMix);
    set(this.chorusWet.gain, fx.chorusMix);
    set(this.chorusFb.gain, fx.chorusFb);

    set(this.reverbDry.gain, 1 - fx.reverbMix);
    set(this.reverbWet.gain, fx.reverbMix);
    // Impulse rebuild is expensive: only when Decay moved noticeably.
    if (!(Math.abs(fx.reverbDecay - this.lastReverbDecay) < 0.05)) {
      this.lastReverbDecay = fx.reverbDecay;
      const seconds = Math.min(6.0, Math.max(0.3, fx.reverbDecay * 1.4));
      this.reverbConv.buffer = makeImpulseResponse(ctx, seconds, fx.reverbDecay);
    }

    set(this.limiter.threshold, fx.limiterThr);
    this.limiter.ratio.setValueAtTime(20, now);
    this.limiter.attack.setValueAtTime(0.003, now);
    set(this.limiter.release, fx.limiterRel);
    this.limiter.knee.setValueAtTime(0, now);

    set(this.delayNode.delayTime, fx.delayTime);
    set(this.delayFb.gain, fx.delayFb);
    set(this.delayDry.gain, 1 - fx.delayMix);
    set(this.delayWet.gain, fx.delayMix);

    const stages = Math.max(1, Math.min(this.phaserFilters.length, Math.floor(fx.phaserStages)));
    if (fx.phaserOn && stages !== this.phaserStagesConnected) {
      this.applyRouting(fx);
    }
    set(this.phaserLFO.frequency, fx.phaserRate);
    set(this.phaserFb.gain, fx.phaserFb);
    set(this.phaserDry.gain, 1 - fx.phaserMix);
    set(this.phaserWet.gain, fx.phaserMix);
    // All-pass center sweep kept strictly positive: [200, 200 + 3600·Depth].
    const fLo = 200;
    const fHi = fLo + 3600 * fx.phaserDepth;
    const pCenter = 0.5 * (fLo + fHi);
    const pHalfSpan = 0.5 * (fHi - fLo);
    for (let i = 0; i < this.phaserFilters.length; i++) {
      this.phaserFilters[i].frequency.setValueAtTime(pCenter, now);
      set(this.phaserLFOGains[i].gain, pHalfSpan);
    }
  }

  setFormulaEnabled(id: string, enabled: boolean, gain: number): void {
    const ctx = this.ctx;
    const st = this.nodes.get(id);
    if (!ctx || !st) return;
    if (this.enabledMap.get(id) !== enabled) {
      this.enabledMap.set(id, enabled);
      st.aw.port.postMessage({ type: 'enabled', enabled });
    }
    st.g.gain.setTargetAtTime(enabled ? gain : 0, ctx.currentTime, GAIN_SMOOTH);
  }

  /** Pushes a whole params record to one generator (gain via the smoothed node gain). */
  setFormulaParams(id: string, params: Params, enabled: boolean): void {
    const ctx = this.ctx;
    const st = this.nodes.get(id);
    if (!ctx || !st) return;
    st.aw.port.postMessage({ type: 'set', params });
    const gain = typeof params.gain === 'number' ? params.gain : 0;
    st.g.gain.setTargetAtTime(enabled ? gain : 0, ctx.currentTime, PARAM_SMOOTH);
  }

  resetFormula(id: string): void {
    this.nodes.get(id)?.aw.port.postMessage({ type: 'reset' });
  }

  private modPayloadFor(formula: string): ModPayload {
    return buildModPayload(this.modState, formula, FORMULAS);
  }

  private pushMod(id: string): void {
    const st = this.nodes.get(id);
    if (!st) return;
    st.aw.port.postMessage({ type: 'mod', ...this.modPayloadFor(id) });
  }

  /** Live update of the modulation matrix: sends routes to every node. */
  setMod(mod: ModState | undefined): void {
    this.modState = mod ?? null;
    if (!this.ctx) return;
    for (const f of FORMULAS) this.pushMod(f.id);
    this.updateFxMod();
  }

  /** Live application of a whole state (preset / morph step). */
  applyState(state: EngineState): void {
    const ctx = this.ctx;
    if (!ctx) return;
    this.setMasterGain(state.masterGain);
    this.applyFx(state.fx);
    for (const f of FORMULAS) {
      const setting = state.formulas[f.id];
      if (!setting) continue;
      this.setFormulaEnabled(f.id, setting.enabled, typeof setting.params.gain === 'number' ? setting.params.gain : 0);
      this.setFormulaParams(f.id, setting.params, setting.enabled);
    }
    this.setMod(state.mod);
  }
}
