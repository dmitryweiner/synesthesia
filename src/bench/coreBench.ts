// PLAN-CORE.md phase 0, the performance gate: can the core's engine, as
// wasm in an AudioWorklet, carry the sound on a phone while the page draws?
//
// 1. Every preset renders `batch` seconds on a separate player inside the
//    worklet (the audio thread's own JIT and caches), timed: the share of
//    the real-time budget one quantum takes.
// 2. The heaviest preset plays live for `idle` s with nothing drawn, then
//    for `secs` while the real picture (SimEngine at a quality rung) draws,
//    then is timed as a batch again while the picture still draws; the worklet times every quantum
//    it renders, and the browser's playback stats count underruns where it
//    has them (Chrome); elsewhere, gaps > 50 ms between quanta are counted.
// 3. Then it plays at `stress`× the work (ballast players of the same
//    preset render beside it) while drawing, and the underruns are counted.
// Gate: the heaviest preset ≤ 35 % of the budget as a batch (idle and while
// drawing), and no underrun live or at 3× the work.
//
// scripts/core-bench.mjs drives this page headless and prints
// window.coreBenchResult; on a phone, press Start and "Copy result".
import init, { presetNames, presetStateJson, coreVersion, WebSession } from '../core/pkg/syn_wasm.js';
import { parseEffects } from '../core/session';
import { ScoutPool, defaultPoolSize } from '../scout/pool';
import type { ScoutJob } from '../scout/protocol';
import { compileCore, createCoreNode, type CoreTransport } from '../core/audio';
import { isCoreBenchResult, isCoreStats, type CoreCommand, type CoreStats } from '../core/protocol';
import { SimEngine } from '../sim/engine';
import { WebPicture, canvasSize, gridFor, ladderRungs, parseFrame, parseSeed } from '../core/picture';

const GATE_PERCENT = 35;
const q = new URLSearchParams(location.search);
const SECS = Number(q.get('secs') ?? 60);
const BATCH = Number(q.get('batch') ?? 5);
const RUNG = Number(q.get('rung') ?? 2);
const DRAW = q.get('draw') !== '0';
const IDLE_SECS = Number(q.get('idle') ?? 20);
/** The stress phase renders this many times the heaviest preset: 3× the
 *  work ≈ the gate's 35 % of the budget, measured by underruns, not a clock. */
const STRESS = Number(q.get('stress') ?? 3);
const STRESS_SECS = Number(q.get('stressSecs') ?? 30);
/** The scout phase (PLAN-CORE.md phase 4): each `seconds@rate` renders
 *  SCOUT_JOBS whole jobs on the worker pool while the heaviest preset plays
 *  and the picture draws. `?scout=0` skips it. */
const SCOUT_CONFIGS: [number, number][] = q.get('scout') === '0' ? []
  : (q.get('scout') ?? '24@11025').split(',').map((c) => {
    const [a, b] = c.split('@').map(Number);
    return [a, b];
  });
const SCOUT_JOBS = Number(q.get('scoutJobs') ?? 3);
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

/** One scout configuration's jobs, run while the sound plays. */
interface ScoutRun { config: string; workers: number; jobSeconds: number[]; underruns: number | null; longGaps: number; maxGapMs: number }

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
    preset: string; seconds: number; percent: number; idlePercent: number; batchDrawingPercent: number;
    maxGapMs: number; longGaps: number;
    underruns: number | null; underrunMs: number | null; fps: number; canvas: string; grid: string;
    stress: { times: number; seconds: number; underruns: number | null; longGaps: number; maxGapMs: number; keptUp: number };
    scout: ScoutRun[];
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
  const rung = ladderRungs()[Math.min(RUNG, ladderRungs().length - 1)];
  const rect = canvas.getBoundingClientRect();
  const store = canvasSize(rung.maxSide, rect.width, rect.height, window.devicePixelRatio || 1);
  canvas.width = store.width;
  canvas.height = store.height;
  const grid = gridFor(rung.res, canvas.width, canvas.height);
  const sim = new SimEngine({ canvas, ...grid });
  // the app's picture: the core's driver on the preset, no sound features
  const pic = new WebPicture(1, presetStateJson(presetIndex) ?? '', false, rung.index);
  sim.reseed(parseSeed(pic.reseed()));
  let frames = 0;
  let running = true;
  const t0 = performance.now();
  const loop = (): void => {
    if (!running) return;
    const f = parseFrame(pic.frame(performance.now() / 1000, new Float64Array(0), sim.aspect));
    sim.step(f);
    sim.render(f);
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

  // 2. the heaviest one live: first with nothing drawn, then while the
  // picture draws (the gate's window), then timed as a batch while it still
  // draws. A batch is immune to Date.now()'s 1 ms steps, so if it agrees
  // with the live number, the picture's load really slows the audio thread
  // (cores, clocks); if the live number is high on its own, the live timing
  // is what is off.
  port.postMessage({ type: 'switchTo', point: pointOf(heaviest.index) } satisfies CoreCommand);
  port.postMessage({ type: 'fadeIn' } satisfies CoreCommand);
  await wait(1000);
  const listen = async (secs: number, label: string): Promise<{ st: CoreStats; underruns: number | null; underrunMs: number | null; wallS: number }> => {
    await reply(port, isCoreStats, { type: 'stats', reset: true });
    const before = playbackStats(ctx);
    const t0 = performance.now();
    for (let s = 0; s < secs; s++) {
      await wait(1000);
      statusEl.textContent = `${label}: ${heaviest.name} ${s + 1}/${secs} s…`;
    }
    const st = await reply(port, isCoreStats, { type: 'stats' });
    const wallS = (performance.now() - t0) / 1000;
    const after = playbackStats(ctx);
    return {
      st, wallS,
      underruns: before && after ? after.events - before.events : null,
      underrunMs: before && after ? after.ms - before.ms : null,
    };
  };
  const loadOf = (st: CoreStats): number => (st.renderMs / ((st.frames * 1000) / report.sampleRate)) * 100;
  const idle = await listen(IDLE_SECS, 'live, not drawing');
  const picture = DRAW ? startPicture(heaviest.index) : null;
  await wait(1000);
  const drawn = await listen(SECS, `live${DRAW ? ', drawing' : ''}`);
  port.postMessage({ type: 'ballast', point: pointOf(heaviest.index), count: STRESS - 1 } satisfies CoreCommand);
  await wait(500);
  const stressed = await listen(STRESS_SECS, `stress ${STRESS}×${DRAW ? ', drawing' : ''}`);
  port.postMessage({ type: 'ballast', point: pointOf(heaviest.index), count: 0 } satisfies CoreCommand);
  await wait(500);
  // the scout's pool working while the sound plays and the picture draws
  const scoutRuns: ScoutRun[] = [];
  if (SCOUT_CONFIGS.length > 0) {
    const pool = new ScoutPool({ module: async () => wasm.module });
    for (const [secs, sr] of SCOUT_CONFIGS) {
      const sess = new WebSession('', presetStateJson(heaviest.index) ?? '', 1, true, secs, sr);
      sess.setPlaying(0, true);
      let job: ScoutJob | null = null;
      for (let i = 1; i < 400 && !job; i++) {
        for (const e of parseEffects(sess.tick(i * 0.05))) if (e.type === 'startScout') job = e.job;
      }
      sess.free();
      if (!job) throw new Error('the session never asked for a scout job');
      await reply(port, isCoreStats, { type: 'stats', reset: true });
      const before = playbackStats(ctx);
      const jobSeconds: number[] = [];
      for (let k = 0; k < SCOUT_JOBS; k++) {
        statusEl.textContent = `scout ${secs} s @ ${sr} Hz: job ${k + 1}/${SCOUT_JOBS} on ${defaultPoolSize()} workers…`;
        jobSeconds.push((await pool.run(job)).seconds);
      }
      const st = await reply(port, isCoreStats, { type: 'stats' });
      const after = playbackStats(ctx);
      scoutRuns.push({
        config: `${secs}@${sr}`, workers: pool.workerCount, jobSeconds,
        underruns: before && after ? after.events - before.events : null, longGaps: st.longGaps, maxGapMs: st.maxGapMs,
      });
    }
    pool.terminate();
  }
  statusEl.textContent = `batch while drawing: ${heaviest.name}…`;
  const batch = await reply(port, isCoreBenchResult, { type: 'bench', point: pointOf(heaviest.index), quanta });
  const pic = picture?.stop() ?? { fps: 0, canvas: '-', grid: '-' };
  port.postMessage({ type: 'fadeOut' } satisfies CoreCommand);
  await wait(200);
  await ctx.close();
  const st = drawn.st;
  report.live = {
    preset: heaviest.name, seconds: st.frames / report.sampleRate, percent: loadOf(st),
    idlePercent: loadOf(idle.st), batchDrawingPercent: (batch.ms / budgetMs) * 100,
    maxGapMs: st.maxGapMs, longGaps: st.longGaps,
    underruns: drawn.underruns, underrunMs: drawn.underrunMs,
    fps: pic.fps, canvas: pic.canvas, grid: pic.grid,
    stress: {
      times: STRESS, seconds: stressed.wallS, underruns: stressed.underruns,
      longGaps: stressed.st.longGaps, maxGapMs: stressed.st.maxGapMs,
      keptUp: stressed.st.frames / (stressed.wallS * report.sampleRate),
    },
    scout: scoutRuns,
  };
  const l = report.live;
  row([`live, not drawing: ${l.preset}`, fmt(l.idlePercent), fmt(100 / Math.max(l.idlePercent, 0.01))]);
  row([`live, drawing: ${l.preset}`, fmt(l.percent), fmt(100 / Math.max(l.percent, 0.01))]);
  row([`batch, drawing: ${l.preset}`, fmt(l.batchDrawingPercent), fmt(100 / Math.max(l.batchDrawingPercent, 0.01))]);
  row([`gaps > 50 ms: ${l.longGaps} (max ${l.maxGapMs} ms)`, `underruns: ${l.underruns ?? 'n/a'}`, `${fmt(l.fps)} fps ${l.grid}`]);
  const x = l.stress;
  row([`stress ${x.times}×: gaps > 50 ms ${x.longGaps} (max ${x.maxGapMs} ms)`, `underruns: ${x.underruns ?? 'n/a'}`, `kept up ${fmt(x.keptUp * 100)} %`]);
  for (const sc of l.scout) {
    const mean = sc.jobSeconds.reduce((a, b) => a + b, 0) / sc.jobSeconds.length;
    row([`scout ${sc.config} (${sc.workers} workers): a job in ${fmt(mean)} s`, `underruns: ${sc.underruns ?? 'n/a'}`, `gaps > 50 ms ${sc.longGaps} (max ${sc.maxGapMs} ms)`]);
  }
  // The live percentages are reported, not gated: Date.now()'s steps are not
  // at random phases of the quantum on every device, and an idle CPU runs
  // the audio thread slowly (on the Mac: 22 % live idle vs 6 % in a batch).
  // 3× the work without an underrun is the gate's "≤ 35 %" without a clock.
  report.pass = heaviest.percent <= GATE_PERCENT && l.batchDrawingPercent <= GATE_PERCENT
    && (l.underruns ?? 0) === 0 && l.longGaps === 0
    && (x.underruns ?? 0) === 0 && x.longGaps === 0 && x.keptUp > 0.99
    && l.scout.every((sc) => (sc.underruns ?? 0) === 0 && sc.longGaps === 0);
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
    verdictEl.textContent = r.pass ? `PASS: ≤ ${GATE_PERCENT} %, no underruns at ${STRESS}× the work` : `FAIL (gate: ≤ ${GATE_PERCENT} %, no underruns at ${STRESS}× the work)`;
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
