// PLAN-CORE.md phase 0, the performance gate: can the core's engine, as
// wasm in an AudioWorklet, carry the sound on a phone while the page draws?
//
// 1. Every preset renders `batch` seconds on a separate player inside the
//    worklet (the audio thread's own JIT and caches), timed: the share of
//    the real-time budget one quantum takes.
// 2. The heaviest preset plays live for `secs` while the real picture
//    (SimEngine at a quality rung) draws; the worklet times every quantum
//    it renders, and the browser's playback stats count underruns where it
//    has them (Chrome); elsewhere, gaps > 50 ms between quanta are counted.
// Gate: ≤ 35 % of the budget for the heaviest preset, no underruns.
//
// scripts/core-bench.mjs drives this page headless and prints
// window.coreBenchResult; on a phone, press Start and "Copy result".
import init, { presetNames, presetStateJson, coreVersion } from '../core/pkg/syn_wasm.js';
import { compileCore, createCoreNode, type CoreTransport } from '../core/audio';
import { isCoreBenchResult, isCoreStats, type CoreCommand } from '../core/protocol';
import { PRESETS } from '../presets';
import { SimEngine } from '../sim/engine';
import { gridSize } from '../sim/grid';
import { backingStore, QUALITY_LADDER } from '../sim/quality';
import { fieldVariationParamsFromCard, flowParamsFromCard, reactionParamsFromCard, ZERO_FIELD_VARIATION, ZERO_FLOW } from '../sim/params';
import { composePalette, palettesByIndex } from '../palette';

const GATE_PERCENT = 35;
const q = new URLSearchParams(location.search);
const SECS = Number(q.get('secs') ?? 60);
const BATCH = Number(q.get('batch') ?? 5);
const RUNG = Math.min(QUALITY_LADDER.length - 1, Number(q.get('rung') ?? 2));
const DRAW = q.get('draw') !== '0';
const TRANSPORT: CoreTransport = q.get('transport') === 'bytes' ? 'bytes' : 'module';
const ONLY = q.get('preset'); // comma list: time only these

function el<T extends HTMLElement>(id: string, type: new () => T): T {
  const e = document.getElementById(id);
  if (!(e instanceof type)) throw new Error(`#${id}`);
  return e;
}
const startBtn = el('start', HTMLButtonElement);
const copyBtn = el('copy', HTMLButtonElement);
const statusEl = el('status', HTMLDivElement);
const verdictEl = el('verdict', HTMLHeadingElement);
const table = el('table', HTMLTableElement);
const envEl = el('env', HTMLPreElement);
const canvas = el('view', HTMLCanvasElement);

interface PresetTiming { index: number; name: string; percent: number; realtime: number }
export interface CoreBenchReport {
  core: string;
  userAgent: string;
  cores: number;
  sampleRate: number;
  baseLatencyMs: number;
  transport: CoreTransport;
  batchSeconds: number;
  presets: PresetTiming[];
  live: {
    preset: string; seconds: number; percent: number; maxGapMs: number; longGaps: number;
    underruns: number | null; underrunMs: number | null; fps: number; canvas: string; grid: string;
  } | null;
  pass: boolean;
}
export type CoreBenchOutcome = CoreBenchReport | { pass: false; error: string };
declare global { interface Window { coreBenchResult?: CoreBenchOutcome } }

const fmt = (x: number, d = 1): string => x.toFixed(d);
const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** The worklet's next message that `is` the reply to `send`. */
function reply<T>(port: MessagePort, is: (d: unknown) => d is T, send: CoreCommand): Promise<T> {
  return new Promise((resolve) => {
    const on = (e: MessageEvent): void => {
      const d: unknown = e.data;
      if (is(d)) {
        port.removeEventListener('message', on);
        resolve(d);
      }
    };
    port.addEventListener('message', on);
    port.start();
    port.postMessage(send);
  });
}

/** Underrun counters from the browser, where it has them: Chrome's
 *  AudioContext.playbackStats (formerly playoutStats). */
function playbackStats(ctx: AudioContext): { events: number; ms: number } | null {
  const s: unknown = Reflect.get(ctx, 'playbackStats') ?? Reflect.get(ctx, 'playoutStats');
  if (typeof s !== 'object' || s === null) return null;
  const num = (k: string): number | null => { const v: unknown = Reflect.get(s, k); return typeof v === 'number' ? v : null; };
  const events = num('underrunEvents') ?? num('fallbackFramesEvents');
  const secs = num('underrunDuration') ?? num('fallbackDuration');
  return events === null ? null : { events, ms: (secs ?? 0) * 1000 };
}

function row(cells: string[], head = false): void {
  const tr = table.insertRow();
  for (const c of cells) {
    const td = document.createElement(head ? 'th' : 'td');
    td.textContent = c;
    tr.appendChild(td);
  }
}

function startPicture(presetIndex: number): { stop: () => { fps: number; canvas: string; grid: string } } {
  const rung = QUALITY_LADDER[RUNG];
  const rect = canvas.getBoundingClientRect();
  const store = backingStore(rung.maxSide, rect.width, rect.height, window.devicePixelRatio || 1);
  canvas.width = store.width;
  canvas.height = store.height;
  const grid = gridSize(rung.res, canvas.width, canvas.height);
  const sim = new SimEngine({ canvas, ...grid });
  const cards = PRESETS[presetIndex].state.visual.cards;
  sim.reaction = reactionParamsFromCard(cards.reaction.params);
  sim.fieldVariation = cards.fieldVariation.on ? fieldVariationParamsFromCard(cards.fieldVariation.params) : { ...ZERO_FIELD_VARIATION };
  sim.flow = cards.flow.on ? flowParamsFromCard(cards.flow.params) : { ...ZERO_FLOW };
  const p = cards.palette.params;
  const palette = composePalette(palettesByIndex(p.paletteId), p.shift, p.contrast, p.bands, p.relief, p.lightAngle, p.gloss);
  let frames = 0;
  let running = true;
  const t0 = performance.now();
  const loop = (): void => {
    if (!running) return;
    sim.step();
    sim.render(palette);
    frames++;
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
  return {
    stop: () => {
      running = false;
      return { fps: frames / ((performance.now() - t0) / 1000), canvas: `${canvas.width}x${canvas.height}`, grid: `${grid.width}x${grid.height}` };
    },
  };
}

async function run(): Promise<CoreBenchReport> {
  const wasm = await compileCore();
  await init({ module_or_path: wasm.module });
  const names = presetNames();
  const pointOf = (i: number): Uint8Array => new TextEncoder().encode(presetStateJson(i) ?? '');

  const ctx = new AudioContext({ latencyHint: 'interactive' });
  if (ctx.state === 'suspended') await ctx.resume();
  const { node, transport } = await createCoreNode(ctx, pointOf(0), TRANSPORT);
  let processorError = '';
  node.onprocessorerror = () => { processorError = 'the processor failed (see the console)'; };
  node.connect(ctx.destination);
  const port = node.port;
  const report: CoreBenchReport = {
    core: coreVersion(), userAgent: navigator.userAgent, cores: navigator.hardwareConcurrency,
    sampleRate: ctx.sampleRate, baseLatencyMs: ctx.baseLatency * 1000, transport,
    batchSeconds: BATCH, presets: [], live: null, pass: false,
  };
  envEl.textContent = `core ${report.core} · ${report.sampleRate} Hz · base latency ${fmt(report.baseLatencyMs)} ms · ${report.cores} cores · module as ${transport}\n${report.userAgent}`;
  await wait(300);
  if (processorError) throw new Error(processorError);

  // 1. every preset on the audio thread, timed
  row(['preset', '% of budget', '× realtime'], true);
  const quanta = Math.round((BATCH * ctx.sampleRate) / 128);
  const budgetMs = (quanta * 128 * 1000) / ctx.sampleRate;
  const which = ONLY ? ONLY.split(',').map(Number) : names.map((_, i) => i);
  for (const i of which) {
    statusEl.textContent = `timing ${i + 1}/${names.length}: ${names[i]}…`;
    const r = await reply(port, isCoreBenchResult, { type: 'bench', point: pointOf(i), quanta });
    if (!r.ok) throw new Error(`preset ${i} did not parse in the core`);
    const percent = (r.ms / budgetMs) * 100;
    const t: PresetTiming = { index: i, name: names[i], percent, realtime: budgetMs / Math.max(r.ms, 0.5) };
    report.presets.push(t);
    row([`${i} ${t.name}`, fmt(percent), fmt(t.realtime)]);
    await wait(50);
  }
  const heaviest = report.presets.reduce((a, b) => (b.percent > a.percent ? b : a));

  // 2. the heaviest one live, while the picture draws
  statusEl.textContent = `live: ${heaviest.name} for ${SECS} s${DRAW ? ', drawing' : ''}…`;
  port.postMessage({ type: 'switchTo', point: pointOf(heaviest.index) } satisfies CoreCommand);
  port.postMessage({ type: 'fadeIn' } satisfies CoreCommand);
  await wait(1000);
  const picture = DRAW ? startPicture(heaviest.index) : null;
  await wait(1000);
  await reply(port, isCoreStats, { type: 'stats', reset: true });
  const before = playbackStats(ctx);
  for (let s = 0; s < SECS; s++) {
    await wait(1000);
    statusEl.textContent = `live: ${heaviest.name} ${s + 1}/${SECS} s${DRAW ? ', drawing' : ''}…`;
  }
  const st = await reply(port, isCoreStats, { type: 'stats' });
  const after = playbackStats(ctx);
  const pic = picture?.stop() ?? { fps: 0, canvas: '-', grid: '-' };
  port.postMessage({ type: 'fadeOut' } satisfies CoreCommand);
  await wait(200);
  await ctx.close();
  const liveMs = (st.frames * 1000) / report.sampleRate;
  report.live = {
    preset: heaviest.name, seconds: liveMs / 1000, percent: (st.renderMs / liveMs) * 100,
    maxGapMs: st.maxGapMs, longGaps: st.longGaps,
    underruns: before && after ? after.events - before.events : null,
    underrunMs: before && after ? after.ms - before.ms : null,
    fps: pic.fps, canvas: pic.canvas, grid: pic.grid,
  };
  const l = report.live;
  row(['live: ' + l.preset, fmt(l.percent), fmt(100 / Math.max(l.percent, 0.01))]);
  row([`gaps > 50 ms: ${l.longGaps} (max ${l.maxGapMs} ms)`, `underruns: ${l.underruns ?? 'n/a'}`, `${fmt(l.fps)} fps ${l.grid}`]);
  report.pass = heaviest.percent <= GATE_PERCENT && l.percent <= GATE_PERCENT
    && (l.underruns ?? 0) === 0 && l.longGaps === 0;
  return report;
}

startBtn.addEventListener('click', () => {
  startBtn.disabled = true;
  table.replaceChildren();
  verdictEl.textContent = '';
  run().then((r) => {
    window.coreBenchResult = r;
    statusEl.textContent = 'done';
    verdictEl.className = r.pass ? 'pass' : 'fail';
    verdictEl.textContent = r.pass ? `PASS: ≤ ${GATE_PERCENT} % and no underruns` : `FAIL (gate: ≤ ${GATE_PERCENT} %, no underruns)`;
  }).catch((e: unknown) => {
    const error = e instanceof Error ? e.message : String(e);
    window.coreBenchResult = { pass: false, error };
    statusEl.textContent = `error: ${error}`;
  }).finally(() => {
    startBtn.disabled = false;
    copyBtn.disabled = !window.coreBenchResult;
  });
});

copyBtn.addEventListener('click', () => {
  void navigator.clipboard.writeText(JSON.stringify(window.coreBenchResult, null, 2)).then(() => {
    copyBtn.textContent = 'Copied';
  });
});
