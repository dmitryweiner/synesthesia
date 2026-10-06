// The live sound on the core (PLAN-CORE.md C1, phase 3): one AudioContext,
// one AudioWorkletNode hosting syn-player (src/worklet/core.ts). Everything
// the old graph did — generators, LFOs, FX, limiter, the analyser and the
// onset detector — happens inside the core; this side only hands it points
// and reads back the feature frames the picture needs. No DOM.
import { createCoreNode } from '../core/audio';
import { isCoreFrame, type CoreCommand } from '../core/protocol';
import type { AppState } from '../state/types';
import { CoreFrames } from './coreFrames';
import type { AudioFeatures } from '../state/types';

/** syn-player's fade length is 80 ms; a switch waits it out, then a little. */
const SWITCH_GAP_MS = 100;

const encoder = new TextEncoder();

/** A point as the core reads it: AppState v1 JSON, the volume as its master gain. */
export function pointBytes(state: AppState, masterGain: number): Uint8Array {
  return encoder.encode(JSON.stringify({ ...state, audio: { ...state.audio, masterGain } }));
}

export class CoreEngine {
  private ctx: AudioContext | null = null;
  private node: AudioWorkletNode | null = null;
  private startTime = 0;
  private readonly frames = new CoreFrames();
  private last: { state: AppState; masterGain: number } | null = null;
  private switching: Promise<void> | null = null;

  get running(): boolean {
    return this.ctx !== null;
  }

  get sampleRate(): number {
    return this.ctx ? this.ctx.sampleRate : 48000;
  }

  /** Seconds of the engine's clock rendered so far — the LFO clock. */
  get time(): number {
    return this.ctx ? this.ctx.currentTime - this.startTime : 0;
  }

  /** The engine time being heard now: rendered minus what the device holds. */
  get heardTime(): number {
    const ctx = this.ctx;
    if (!ctx) return 0;
    const stamp = typeof ctx.getOutputTimestamp === 'function' ? ctx.getOutputTimestamp().contextTime : undefined;
    const played = stamp !== undefined && stamp > 0 ? stamp : ctx.currentTime - (ctx.outputLatency || ctx.baseLatency || 0);
    return Math.max(0, played - this.startTime);
  }

  private send(cmd: CoreCommand): void {
    this.node?.port.postMessage(cmd);
  }

  async start(state: AppState, masterGain: number): Promise<void> {
    if (this.ctx) return;
    const ctx = new AudioContext({ latencyHint: 'interactive' });
    if (ctx.state === 'suspended') await ctx.resume();
    const { node } = await createCoreNode(ctx, pointBytes(state, masterGain));
    node.port.onmessage = (e: MessageEvent) => {
      const d: unknown = e.data;
      if (isCoreFrame(d)) this.frames.push(d.f);
    };
    node.connect(ctx.destination);
    this.ctx = ctx;
    this.node = node;
    this.startTime = ctx.currentTime;
    this.last = { state, masterGain };
    this.frames.clear();
    this.send({ type: 'fadeIn' });
  }

  async resume(): Promise<void> {
    if (this.ctx && this.ctx.state === 'suspended') await this.ctx.resume();
  }

  /** Glide to a point (a morph step, a settings edit): nothing is rebuilt. */
  applyState(state: AppState, masterGain: number): void {
    this.last = { state, masterGain };
    if (!this.switching) this.send({ type: 'setPoint', point: pointBytes(state, masterGain) });
  }

  /** A hard switch (a preset, a link): fade out, drop the old point's tails, fade in. */
  async switchTo(state: AppState, masterGain: number): Promise<void> {
    this.last = { state, masterGain };
    if (!this.node) return;
    if (this.switching) return this.switching;
    this.send({ type: 'fadeOut' });
    this.switching = new Promise<void>((resolve) => {
      setTimeout(() => {
        this.switching = null;
        // the newest point asked for while fading, not the one that started it
        const last = this.last;
        if (last) this.send({ type: 'switchTo', point: pointBytes(last.state, last.masterGain) });
        this.send({ type: 'fadeIn' });
        resolve();
      }, SWITCH_GAP_MS);
    });
    return this.switching;
  }

  setMasterGain(v: number): void {
    if (this.last) this.applyState(this.last.state, v);
  }

  /** Fades out and closes the context. */
  async stop(): Promise<void> {
    const ctx = this.ctx;
    if (!ctx) return;
    this.send({ type: 'fadeOut' });
    await new Promise((r) => setTimeout(r, SWITCH_GAP_MS));
    this.node?.disconnect();
    await ctx.close();
    this.ctx = null;
    this.node = null;
    this.switching = null;
    this.frames.clear();
  }

  /** The feature frame being heard now (src/core/protocol.ts FRAME
   *  layout), or null before the first one. */
  heard(): Float64Array | null {
    return this.ctx ? this.frames.at(this.heardTime) : null;
  }

  /** What the picture reads about the sound being heard now. */
  features(): AudioFeatures | null {
    return this.frames.features(this.heardTime);
  }

  /** True once per onset hit, when it is heard. */
  hitHeard(): boolean {
    return this.frames.hitHeard(this.heardTime);
  }
}
