// The core's AudioWorklet mechanics (PLAN-CORE.md phase 0), run in node
// against the real wasm package: a worklet scope without TextDecoder, the
// module handed over in processorOptions (compiled, or as bytes), and one
// output view for every quantum.
import { readFileSync } from 'node:fs';
import { decodeUtf8, encodeUtf8 } from '../src/worklet/textPolyfill';
import { FRAME, FRAME_LEN, isCoreFrame, isCoreStats, type CoreCommand, type CoreProcessorOptions, type CoreStats } from '../src/core/protocol';

const WASM = readFileSync(new URL('../src/core/pkg/syn_wasm_bg.wasm', import.meta.url));

interface Proc {
  process(inputs: Float32Array[][], outputs: Float32Array[][]): boolean;
  port: { onmessage: ((e: { data: CoreCommand }) => void) | null; posted: unknown[] };
}
type ProcCtor = new (options: { processorOptions: CoreProcessorOptions }) => Proc;

/** Loads src/worklet/core.ts in a fresh module graph, in a scope shaped like
 *  AudioWorkletGlobalScope: no TextDecoder, registerProcessor, sampleRate. */
class FakePort {
  onmessage: ((e: { data: CoreCommand }) => void) | null = null;
  posted: unknown[] = [];
  postMessage(m: unknown): void { this.posted.push(m); }
}

async function loadWorklet(): Promise<ProcCtor> {
  vi.resetModules();
  const registered: { ctor?: ProcCtor } = {};
  vi.stubGlobal('TextDecoder', undefined);
  vi.stubGlobal('TextEncoder', undefined);
  vi.stubGlobal('sampleRate', 48000);
  vi.stubGlobal('AudioWorkletProcessor', class { port = new FakePort(); });
  vi.stubGlobal('registerProcessor', (_name: string, c: ProcCtor) => { registered.ctor = c; });
  await import('../src/worklet/core');
  if (!registered.ctor) throw new Error('no processor registered');
  return registered.ctor;
}

const encode = (s: string): Uint8Array => new TextEncoder().encode(s);

async function presetPoint(i: number): Promise<Uint8Array> {
  const { initSync, presetStateJson } = await import('../src/core/pkg/syn_wasm.js');
  initSync({ module: new WebAssembly.Module(WASM) });
  const json = presetStateJson(i);
  if (!json) throw new Error(`no preset ${i}`);
  return encode(json);
}

const last = (xs: unknown[]): unknown => xs[xs.length - 1];

function quantum(): Float32Array[][] {
  return [[new Float32Array(128), new Float32Array(128)]];
}

describe('the minimal TextEncoder', () => {
  it('encodes UTF-8 like the real one', () => {
    for (const str of ['Overtone steppe', 'Танпура — 🎲', '', 'a\u2028b']) {
      expect(Array.from(encodeUtf8(str))).toEqual(Array.from(new TextEncoder().encode(str)));
    }
    expect(Array.from(encodeUtf8('\ud800'))).toEqual([0xef, 0xbf, 0xbd]);
  });
});

describe('the minimal TextDecoder', () => {
  it('decodes UTF-8 like the real one, invalid bytes as U+FFFD', () => {
    for (const s of ['Overtone steppe', 'Candle glaze — iridescent', 'Танпура', '🎲 ↩', '']) {
      expect(decodeUtf8(encode(s))).toBe(s);
    }
    expect(decodeUtf8(new Uint8Array([0x61, 0xff, 0x62]))).toBe('a�b');
    expect(decodeUtf8(new Uint8Array([0x61, 0xe2, 0x80]))).toMatch(/^a\ufffd+$/);
  });
});

describe('the core processor', () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  it('loads where the scope has no TextDecoder and plays a preset', async () => {
    const point = await presetPoint(0);
    const Ctor = await loadWorklet();
    const p = new Ctor({ processorOptions: { module: new WebAssembly.Module(WASM), point } });
    p.port.onmessage?.({ data: { type: 'fadeIn' } });
    const out = quantum();
    let energy = 0;
    for (let i = 0; i < 400; i++) {
      expect(p.process([], out)).toBe(true);
      for (const v of out[0][0]) energy += v * v;
    }
    expect(energy).toBeGreaterThan(0);
    expect(Array.from(out[0][1])).toEqual(Array.from(out[0][0]));
  });

  it('takes the module as bytes when a Module cannot be handed over', async () => {
    const point = await presetPoint(3);
    const Ctor = await loadWorklet();
    const bytes = WASM.buffer.slice(WASM.byteOffset, WASM.byteOffset + WASM.byteLength);
    const p = new Ctor({ processorOptions: { bytes, point } });
    expect(p.process([], quantum())).toBe(true);
  });

  it('remakes the output view only when the memory grew, never per quantum', async () => {
    const point = await presetPoint(0);
    const Ctor = await loadWorklet();
    const p = new Ctor({ processorOptions: { module: new WebAssembly.Module(WASM), point } });
    const stats = (): CoreStats => {
      p.port.onmessage?.({ data: { type: 'stats' } });
      const s = last(p.port.posted);
      if (!isCoreStats(s)) throw new Error('no stats');
      return s;
    };
    p.port.onmessage?.({ data: { type: 'fadeIn' } });
    const out = quantum();
    for (let i = 0; i < 1000; i++) p.process([], out);
    expect(stats().views).toBe(1);
    // a new point is parsed inside the module, which may grow its memory once
    p.port.onmessage?.({ data: { type: 'switchTo', point: await presetPoint(5) } });
    for (let i = 0; i < 1000; i++) p.process([], out);
    const after = stats().views;
    expect(after).toBeLessThanOrEqual(2);
    for (let i = 0; i < 3000; i++) p.process([], out);
    const s = stats();
    expect(s.views).toBe(after);
    expect(s.quanta).toBe(5000);
    expect(s.frames).toBe(5000 * 128);
    expect(s.time).toBeCloseTo((5000 * 128) / 48000, 9);
  });

  it('renders ballast players beside the live one without touching its sound', async () => {
    const point = await presetPoint(8);
    const Ctor = await loadWorklet();
    const plain = new Ctor({ processorOptions: { module: new WebAssembly.Module(WASM), point } });
    const loaded = new Ctor({ processorOptions: { module: new WebAssembly.Module(WASM), point } });
    loaded.port.onmessage?.({ data: { type: 'ballast', point, count: 2 } });
    for (const p of [plain, loaded]) p.port.onmessage?.({ data: { type: 'fadeIn' } });
    const a = quantum();
    const b = quantum();
    for (let i = 0; i < 300; i++) {
      plain.process([], a);
      loaded.process([], b);
      expect(b[0][0]).toEqual(a[0][0]);
    }
    loaded.port.onmessage?.({ data: { type: 'stats' } });
    expect(last(loaded.port.posted)).toMatchObject({ ballast: 2 });
    loaded.port.onmessage?.({ data: { type: 'ballast', point, count: 0 } });
    loaded.port.onmessage?.({ data: { type: 'stats' } });
    expect(last(loaded.port.posted)).toMatchObject({ ballast: 0 });
  });

  it('posts a feature frame about every 21 ms, stamped on the engine clock', async () => {
    const point = await presetPoint(10); // Bell spots: struck, so it has hits
    const Ctor = await loadWorklet();
    const p = new Ctor({ processorOptions: { module: new WebAssembly.Module(WASM), point } });
    p.port.onmessage?.({ data: { type: 'fadeIn' } });
    const out = quantum();
    for (let i = 0; i < 375 * 8; i++) p.process([], out); // 8 s
    const frames = p.port.posted.filter(isCoreFrame).map((m) => m.f);
    expect(frames.length).toBeGreaterThan(330);
    expect(frames.length).toBeLessThan(380);
    expect(frames.every((f) => f.length === FRAME_LEN)).toBe(true);
    const times = frames.map((f) => f[FRAME.time]);
    expect(times.every((t, i) => i === 0 || t > times[i - 1])).toBe(true);
    expect(times[times.length - 1]).toBeCloseTo(8, 1);
    const last = frames[frames.length - 1];
    expect(last[FRAME.loudness]).toBeGreaterThan(0);
    expect(last[FRAME.hits]).toBeGreaterThan(0);
  });

  it('times a preset on a separate player without moving the live one', async () => {
    const point = await presetPoint(0);
    const Ctor = await loadWorklet();
    const p = new Ctor({ processorOptions: { module: new WebAssembly.Module(WASM), point } });
    p.port.onmessage?.({ data: { type: 'bench', point: await presetPoint(7), quanta: 375 } });
    expect(last(p.port.posted)).toMatchObject({ type: 'bench', quanta: 375, ok: true });
    p.port.onmessage?.({ data: { type: 'bench', point: encode('{}'), quanta: 1 } });
    expect(last(p.port.posted)).toMatchObject({ ok: false });
    p.port.onmessage?.({ data: { type: 'stats' } });
    expect(last(p.port.posted)).toMatchObject({ type: 'stats', time: 0 });
  });
});
