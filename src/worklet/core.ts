// The core's engine in one AudioWorklet (PLAN-CORE.md C1): syn-player
// renders every quantum; commands arrive over the port.
//
// Mechanics settled in phase 0, each pinned by tests/coreWorklet.test.ts:
// - the scope has no fetch: the main thread compiles the WebAssembly.Module
//   and hands it over in processorOptions (or the bytes, where a browser
//   cannot clone a Module into the worklet — compiled here then);
// - no TextDecoder in some browsers: textPolyfill is imported first, and
//   the audio exports speak numbers and byte arrays only;
// - nothing allocates per quantum: the output is one view onto the module's
//   memory, remade only when the memory grows.
import './textPolyfill';
import { initSync, AudioCore } from '../core/pkg/syn_wasm.js';
import { CORE_PROCESSOR, type CoreBenchResult, type CoreCommand, type CoreProcessorOptions, type CoreStats } from '../core/protocol';

function isOptions(o: unknown): o is CoreProcessorOptions {
  return typeof o === 'object' && o !== null && 'point' in o && o.point instanceof Uint8Array
    && (('module' in o && o.module instanceof WebAssembly.Module) || ('bytes' in o && o.bytes instanceof ArrayBuffer));
}

function isCommand(c: unknown): c is CoreCommand {
  return typeof c === 'object' && c !== null && 'type' in c && typeof c.type === 'string';
}

const LONG_GAP_MS = 50;

class CoreProcessor extends AudioWorkletProcessor {
  private readonly memory: WebAssembly.Memory;
  private readonly core: AudioCore;
  private out = new Float32Array(0);
  private outPtr = -1;
  private outBuffer: ArrayBufferLike | null = null;
  private stats: CoreStats = CoreProcessor.zeroStats();
  private lastStart = 0;
  private ballast: AudioCore[] = [];

  constructor(options?: { processorOptions?: unknown }) {
    super();
    const o = options?.processorOptions;
    if (!isOptions(o)) throw new Error('synesthesia-core: processorOptions need a point and a module (or its bytes)');
    const module = o.module ?? o.bytes;
    if (module === undefined) throw new Error('synesthesia-core: no module');
    this.memory = initSync({ module }).memory;
    const core = AudioCore.create(sampleRate, o.point, 128);
    if (!core) throw new Error('synesthesia-core: the initial point does not parse');
    this.core = core;
    this.port.onmessage = (e: MessageEvent) => { if (isCommand(e.data)) this.command(e.data); };
  }

  private static zeroStats(): CoreStats {
    return { type: 'stats', quanta: 0, frames: 0, renderMs: 0, maxGapMs: 0, longGaps: 0, views: 0, ballast: 0, time: 0 };
  }

  private command(c: CoreCommand): void {
    switch (c.type) {
      case 'switchTo': this.core.switchTo(c.point); break;
      case 'setPoint': this.core.setPoint(c.point); break;
      case 'fadeIn': this.core.fadeIn(); break;
      case 'fadeOut': this.core.fadeOut(); break;
      case 'stats': {
        this.port.postMessage({ ...this.stats, ballast: this.ballast.length, time: this.core.time() });
        if (c.reset) {
          const views = this.stats.views;
          this.stats = CoreProcessor.zeroStats();
          this.stats.views = views;
          this.lastStart = 0;
        }
        break;
      }
      case 'ballast': {
        for (const b of this.ballast) b.free();
        this.ballast = [];
        for (let i = 0; i < c.count; i++) {
          const b = AudioCore.create(sampleRate, c.point, 128);
          if (!b) break;
          b.fadeIn();
          this.ballast.push(b);
        }
        break;
      }
      case 'bench': {
        const p = AudioCore.create(sampleRate, c.point, 128);
        const result: CoreBenchResult = { type: 'bench', quanta: c.quanta, ms: 0, ok: p !== undefined };
        if (p) {
          p.fadeIn();
          const t0 = Date.now();
          for (let i = 0; i < c.quanta; i++) p.render(128);
          result.ms = Date.now() - t0;
          p.free();
        }
        this.port.postMessage(result);
        break;
      }
    }
  }

  process(_inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
    const start = Date.now();
    const channels = outputs[0];
    const n = channels[0].length;
    const ptr = this.core.render(n);
    for (const b of this.ballast) b.render(n);
    if (ptr !== this.outPtr || this.memory.buffer !== this.outBuffer || this.out.length !== n) {
      this.outBuffer = this.memory.buffer;
      this.outPtr = ptr;
      this.out = new Float32Array(this.outBuffer, ptr, n);
      this.stats.views++;
    }
    for (const ch of channels) ch.set(this.out);
    const s = this.stats;
    s.renderMs += Date.now() - start;
    s.quanta++;
    s.frames += n;
    if (this.lastStart > 0) {
      const gap = start - this.lastStart;
      if (gap > s.maxGapMs) s.maxGapMs = gap;
      if (gap > LONG_GAP_MS) s.longGaps++;
    }
    this.lastStart = start;
    return true;
  }
}

registerProcessor(CORE_PROCESSOR, CoreProcessor);
