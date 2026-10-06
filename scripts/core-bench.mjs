#!/usr/bin/env node
// PLAN-CORE.md phase 0's performance gate, headless: opens core-bench.html
// (src/bench/coreBench.ts) in Chromium, presses Start and prints what it
// measured — every preset's share of the audio budget on the worklet's
// thread, then the heaviest one live while the picture draws.
//
//   npm run bench:core                       # 60 s live, rung 2, drawing
//   npm run bench:core -- --secs 20 --batch 3 --rung 4 --draw 0
//   npm run bench:core -- --transport bytes  # the Module-less fallback
//   npm run bench:core -- --json shots/core-bench.json
//
// This machine's number is not the gate: the gate is a mid-range Android
// phone in Chrome and an iPhone in Safari. Serve the page to a phone over
// HTTPS (an AudioWorklet needs a secure context) and press Start there.
import { writeFileSync } from 'node:fs';
import { parseFlags, startServer, launchBrowser, captureErrors } from './lib.mjs';

const { flags } = parseFlags(process.argv.slice(2), ['secs', 'idle', 'batch', 'rung', 'draw', 'transport', 'preset', 'stress', 'stressSecs', 'scout', 'scoutJobs', 'json']);
const query = new URLSearchParams();
for (const k of ['secs', 'idle', 'batch', 'rung', 'draw', 'transport', 'preset', 'stress', 'stressSecs', 'scout', 'scoutJobs']) if (flags.has(k)) query.set(k, flags.get(k));
const secs = Number(flags.get('secs') ?? 60);

const { BASE, stop } = await startServer(false);
const browser = await launchBrowser();
const errors = [];
try {
  const page = await browser.newPage();
  captureErrors(page, errors, () => 'bench');
  await page.goto(`${BASE}/core-bench.html?${query}`, { waitUntil: 'load', timeout: 60000 });
  await page.click('#start');
  await page.waitForFunction(() => window.coreBenchResult !== undefined, null, { timeout: (secs + 200 + Number(flags.get('idle') ?? 20) + Number(flags.get('stressSecs') ?? 30) + 300) * 1000, polling: 1000 });
  const r = await page.evaluate(() => window.coreBenchResult);
  if (r.error) {
    console.error(`bench failed: ${r.error}`);
    process.exitCode = 1;
  } else {
    console.log(`core ${r.core} · ${r.sampleRate} Hz · base latency ${r.baseLatencyMs.toFixed(1)} ms · module as ${r.transport} · ${r.cores} cores`);
    console.log(`${'preset'.padEnd(28)} ${'% budget'.padStart(9)} ${'× realtime'.padStart(11)}   (${r.batchSeconds} s each, on the worklet's thread)`);
    for (const p of r.presets) {
      console.log(`${`${p.index} ${p.name}`.padEnd(28)} ${p.percent.toFixed(1).padStart(9)} ${p.realtime.toFixed(1).padStart(11)}`);
    }
    const l = r.live;
    console.log(`${l.preset}: live not drawing ${l.idlePercent.toFixed(1)} %, batch while drawing ${l.batchDrawingPercent.toFixed(1)} %`);
    console.log(`live: ${l.preset}, ${l.seconds.toFixed(0)} s: ${l.percent.toFixed(1)} % of the budget; `
      + `underruns ${l.underruns ?? 'n/a'}${l.underrunMs ? ` (${l.underrunMs.toFixed(0)} ms)` : ''}; `
      + `gaps > 50 ms ${l.longGaps} (max ${l.maxGapMs} ms); picture ${l.fps.toFixed(1)} fps, canvas ${l.canvas}, grid ${l.grid}`);
    const x = l.stress;
    console.log(`stress ${x.times}× for ${x.seconds.toFixed(0)} s: underruns ${x.underruns ?? 'n/a'}; gaps > 50 ms ${x.longGaps} (max ${x.maxGapMs} ms); kept up ${(x.keptUp * 100).toFixed(1)} %`);
    for (const sc of l.scout) {
      console.log(`scout ${sc.config} on ${sc.workers} workers: jobs ${sc.jobSeconds.map((x) => x.toFixed(2)).join(' / ')} s; underruns ${sc.underruns ?? 'n/a'}; gaps > 50 ms ${sc.longGaps} (max ${sc.maxGapMs} ms)`);
    }
    console.log(r.pass ? 'gate: PASS on this machine' : 'gate: FAIL on this machine');
  }
  if (flags.has('json')) writeFileSync(flags.get('json'), JSON.stringify(r, null, 2));
} finally {
  await browser.close();
  stop();
}
if (errors.length) {
  console.error(errors.join('\n'));
  process.exitCode = 1;
}
