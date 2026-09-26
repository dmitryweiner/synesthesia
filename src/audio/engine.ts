// Audio engine: AudioContext, worklet generators, FX chain, analyser. No DOM
// — takes ready state (schema/audio.ts), the app calls methods. Ported from
// formula-synth (recorder dropped; the analyser feeds src/audio/features.ts).
// The same graph can also be rendered faster than real time into an
// OfflineAudioContext (renderOffline) — scripts/analyze.mjs measures the
// app's actual sound, FX and LFOs included, that way.
import workletUrl from '../worklet/processors.ts?worker&url';
import { FORMULAS } from '../schema/audio';
import type { FxState } from '../schema/audio';
import type { Params } from '../dsp/generator';
import type { ModRoute, ModState } from '../dsp/mod';
import { clampNum, filterMode, toBiquadType, vowelFormants } from './filters';
import { buildModPayload, modulateFx } from './modrouting';
import type { ModPayload } from './modrouting';
import { RENDER_SEED, generatorSeed, roomImpulse } from './seed';

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
const DUCK_TC = 0.006;         // s — master fade-out before a topology change
const REROUTE_GAP_MS = 30;     // wait before reconnecting FX while ducked (≈5·DUCK_TC)
const REROUTE_RETURN_TC = 0.015;
const SWITCH_GAP_MS = 40;      // preset switch: duck, rebuild FX, apply, fade in
const SWITCH_RETURN_TC = 0.05; // ≈150 ms fade-in of the new preset

// The room is seeded (src/audio/seed.ts, PLAN.md #21): same params, same room.
function makeImpulseResponse(ctx: BaseAudioContext, seconds: number, decay: number, seed: number): AudioBuffer {
  const sr = ctx.sampleRate;
  const len = Math.max(1, Math.floor(sr * seconds));
  const buf = ctx.createBuffer(2, len, sr);
  const [l, r] = roomImpulse(len, sr, decay, seed);
  buf.getChannelData(0).set(l);
  buf.getChannelData(1).set(r);
  return buf;
}

export class AudioEngine {
  private ctx: BaseAudioContext | null = null;
  private offline = false;
  private seed = RENDER_SEED;
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
  private shimmerNode!: AudioWorkletNode; // in the delay's feedback loop (PLAN.md #20)
  private shimmerAmount!: AudioParam;

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

  // Clicks come from changing the FX topology (connect/disconnect with
  // signal in the chain) and from FX tails of a previous preset (a delay line
  // whose time jumps pitch-warbles its old content). So: the master "ducks"
  // around every rerouting, and a preset switch rebuilds the FX nodes from
  // scratch while ducked (switchTo).
  private masterLevel = 0.75;
  private ducked = false;
  private rerouteTimer: ReturnType<typeof setTimeout> | null = null;
  private pendingRouting: FxState | null = null;
  private freshParams = false;

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
    if (this.ctx instanceof AudioContext && this.ctx.state === 'suspended') await this.ctx.resume();
  }

  async start(state: EngineState): Promise<void> {
    if (this.ctx) return;

    const ctx = new AudioContext({ latencyHint: 'interactive' });
    if (ctx.state === 'suspended') await ctx.resume();
    await ctx.audioWorklet.addModule(workletUrl);
    this.build(ctx, state);
  }

  /**
   * Renders `seconds` of the given state offline (mono) — the exact live
   * graph, with FX modulation scheduled ahead as automation instead of the
   * live control-rate timer. The same state and seed render the same
   * samples; the live app plays seed RENDER_SEED, and the analysis passes
   * other seeds to average over rooms.
   */
  static async renderOffline(
    state: EngineState, seconds: number, sampleRate = 44100,
    switches: readonly { t: number; state: EngineState }[] = [],
    seed = RENDER_SEED,
  ): Promise<Float32Array> {
    const ctx = new OfflineAudioContext(1, Math.max(1, Math.round(seconds * sampleRate)), sampleRate);
    await ctx.audioWorklet.addModule(workletUrl);
    const eng = new AudioEngine();
    eng.offline = true;
    eng.seed = seed;
    eng.build(ctx, state);
    const scheduleFxMod = (from: number, to: number): void => {
      const routes = eng.fxRoutes();
      if (routes.length === 0 || !eng.baseFx || !eng.modState) return;
      for (let t = from; t < to; t += FX_MOD_INTERVAL_MS / 1000) {
        eng.applyFxParams(modulateFx(eng.baseFx, routes, eng.modState.lfos, t), t);
      }
    };
    const sorted = [...switches].sort((a, b) => a.t - b.t);
    scheduleFxMod(0, sorted[0]?.t ?? seconds);
    // A preset switch mid-render runs the same two phases as the live
    // switchTo(): duck at t, rebuild + apply + fade in SWITCH_GAP later
    // (scripts/analyze.mjs --switch measures the result).
    const gap = SWITCH_GAP_MS / 1000;
    sorted.forEach((sw, i) => {
      void ctx.suspend(sw.t).then(() => {
        eng.beginSwitch();
        void ctx.resume();
      });
      void ctx.suspend(sw.t + gap).then(() => {
        eng.finishSwitch(sw.state);
        scheduleFxMod(sw.t + gap, sorted[i + 1]?.t ?? seconds);
        void ctx.resume();
      });
    });
    const buf = await ctx.startRendering();
    return buf.getChannelData(0);
  }

  private build(ctx: BaseAudioContext, state: EngineState): void {
    this.ctx = ctx;

    this.analyserNode = ctx.createAnalyser();
    this.analyserNode.fftSize = 2048;
    this.analyserNode.smoothingTimeConstant = 0.5;

    this.mixBus = ctx.createGain();
    this.mixBus.gain.value = 1;

    this.createFx(ctx);

    this.master = ctx.createGain();
    this.master.gain.value = state.masterGain;
    this.masterLevel = state.masterGain;

    this.startTime = ctx.currentTime;
    this.modState = state.mod ?? null;
    this.applyFx(state.fx);

    FORMULAS.forEach((f, index) => {
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
          seed: generatorSeed(this.seed, index),
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
    });
  }

  /** Creates every FX node (fresh delay lines/convolver: no tails). */
  private createFx(ctx: BaseAudioContext): void {
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
    this.shimmerNode = new AudioWorkletNode(ctx, 'shimmer', {
      numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1],
      channelCount: 1, channelCountMode: 'explicit',
    });
    const amount = this.shimmerNode.parameters.get('amount');
    if (!amount) throw new Error('shimmer worklet has no amount parameter');
    this.shimmerAmount = amount;

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
    this.routingKey = '';
    this.phaserStagesConnected = 0;
  }

  /** Disconnects and releases every FX node (their tails go with them). */
  private destroyFx(): void {
    const nodes: AudioNode[] = [
      this.filterNode, ...this.formantBands, ...this.formantGains, this.formantSum,
      this.combInput, this.combDelay, this.combFb,
      this.chorusDelay, this.chorusDry, this.chorusWet, this.chorusFb, this.chorusSum, this.chorusLFOGain,
      this.reverbConv, this.reverbDry, this.reverbWet, this.reverbSum, this.limiter,
      this.delayNode, this.delayDry, this.delayWet, this.delayFb, this.delaySum, this.shimmerNode,
      ...this.phaserFilters, ...this.phaserLFOGains, this.phaserDry, this.phaserWet, this.phaserFb,
      this.phaserInput, this.phaserOutput, this.phaserSum,
    ];
    for (const n of nodes) n.disconnect();
    for (const osc of [this.chorusLFO, this.phaserLFO]) {
      try { osc.stop(); } catch { /* already stopped */ }
      osc.disconnect();
    }
  }

  private duck(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    this.ducked = true;
    this.master.gain.cancelScheduledValues(ctx.currentTime);
    this.master.gain.setTargetAtTime(0, ctx.currentTime, DUCK_TC);
  }

  private unduck(tc: number): void {
    const ctx = this.ctx;
    if (!ctx) return;
    this.ducked = false;
    this.master.gain.cancelScheduledValues(ctx.currentTime);
    this.master.gain.setTargetAtTime(this.masterLevel, ctx.currentTime, tc);
  }

  /** Reroutes the FX chain behind a short master dip (live morphs toggling an FX module). */
  private rerouteSmoothly(fx: FxState): void {
    this.pendingRouting = fx;
    if (this.rerouteTimer !== null) return;
    this.duck();
    this.rerouteTimer = setTimeout(() => {
      this.rerouteTimer = null;
      const pending = this.pendingRouting;
      this.pendingRouting = null;
      if (!this.ctx || !pending) return;
      this.applyRouting(pending);
      this.unduck(REROUTE_RETURN_TC);
    }, REROUTE_GAP_MS);
  }

  /** Phase 1 of a preset switch: fade the master out. */
  beginSwitch(): void {
    this.duck();
  }

  /** Phase 2: fresh FX nodes (no old tails), the new state applied at once, fade in. */
  finishSwitch(state: EngineState): void {
    const ctx = this.ctx;
    if (!ctx) return;
    if (this.rerouteTimer !== null) {
      clearTimeout(this.rerouteTimer);
      this.rerouteTimer = null;
      this.pendingRouting = null;
    }
    this.destroyFx();
    this.createFx(ctx);
    this.freshParams = true;
    this.masterLevel = state.masterGain;
    this.applyState(state);
    this.freshParams = false;
    this.unduck(SWITCH_RETURN_TC);
  }

  /** A hard switch to a different point (preset / link): no clicks, no tails of the old one. */
  async switchTo(state: EngineState): Promise<void> {
    if (!this.ctx) return;
    this.beginSwitch();
    await new Promise((r) => setTimeout(r, SWITCH_GAP_MS));
    this.finishSwitch(state);
  }

  /** Fades the master out and closes the context. */
  async stop(): Promise<void> {
    const ctx = this.ctx;
    if (!ctx) return;
    this.stopFxModTimer();
    this.master.gain.setTargetAtTime(0, ctx.currentTime, 0.01);
    if (this.rerouteTimer !== null) clearTimeout(this.rerouteTimer);
    this.rerouteTimer = null;
    await new Promise((r) => setTimeout(r, 80));
    this.destroyFx();
    if (ctx instanceof AudioContext) await ctx.close();
    this.ctx = null;
    this.analyserNode = null;
    this.nodes.clear();
    this.enabledMap.clear();
    this.routingKey = '';
    this.ducked = false;
  }

  setMasterGain(v: number): void {
    this.masterLevel = v;
    if (this.ctx && !this.ducked) this.master.gain.setTargetAtTime(v, this.ctx.currentTime, PARAM_SMOOTH);
  }

  /** Full FX application: routing (only if the on/type/stage set changed) + params (+ mod timer). */
  applyFx(fx: FxState): void {
    if (!this.ctx) return;
    this.baseFx = fx;
    const key = [fx.filterOn, fx.filterType, fx.chorusOn, fx.phaserOn, fx.phaserStages, fx.delayOn, fx.reverbOn, fx.limiterOn].join('|');
    if (key !== this.routingKey) {
      const first = this.routingKey === '';
      this.routingKey = key;
      // Live and already sounding: dip the master around the reconnect.
      if (first || this.offline || this.ducked) this.applyRouting(fx);
      else this.rerouteSmoothly(fx);
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
    if (this.offline) {
      this.applyFxParams(this.baseFx); // renderOffline schedules the modulation itself
      return;
    }
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
    this.delaySum.disconnect(); this.shimmerNode.disconnect();

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
      this.delayFb.connect(this.shimmerNode);
      this.shimmerNode.connect(this.delayNode);
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

  /** Applies FX params at `when` (context time; default now). */
  applyFxParams(fx: FxState, when?: number): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const now = when ?? ctx.currentTime;

    // Values arrive at control rate during modulation AND during genome
    // morphs, so always smooth: setValueAtTime would zipper/click, which the
    // phaser's feedback loop rings on.
    // Freshly built nodes (preset switch) take their values at once.
    const fresh = this.freshParams;
    const set = (p: AudioParam, v: number): void => {
      if (fresh) p.setValueAtTime(v, now);
      else p.setTargetAtTime(v, now, FX_SMOOTH_TC);
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
      this.reverbConv.buffer = makeImpulseResponse(ctx, seconds, fx.reverbDecay, this.seed);
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
    set(this.shimmerAmount, clampNum(fx.delayShimmer, 0, 1));

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
