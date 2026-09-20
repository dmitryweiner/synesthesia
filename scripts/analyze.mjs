#!/usr/bin/env node
// Measures how "fractal" the app's actual sound is: renders points through
// the real audio graph (worklet generators + FX + LFOs) in an
// OfflineAudioContext inside headless Chromium, then runs
// src/analysis/fractal.ts on the result. Needs the Vite dev server (the page
// imports TS sources directly), which is started if not running.
//
//   node scripts/analyze.mjs                       # every built-in preset
//   node scripts/analyze.mjs --preset 0,3 --secs 40
//   node scripts/analyze.mjs --hash <share token>
//   node scripts/analyze.mjs --mutants 6           # + 6 👍/👎 proposals per preset
//   node scripts/analyze.mjs --random 12           # + 12 random points (baseline)
//   node scripts/analyze.mjs --wav shots/wav --json shots/analysis.json
//   node scripts/analyze.mjs --mutants 6 --configs 30@22050,8@16000,24@8000
//       # score every point under several render windows (secs@sr) and print
//       # each window's Spearman rank correlation with the first one — how
//       # well a cheap render (the in-app scout's) predicts the long one
//   node scripts/analyze.mjs --onsets [--fps 60,30,15] [--secs 20]
//       # how many onset hits each preset produces through the REAL graph
//       # (the picture seeds growth + ripples on every hit) and how far the
//       # loudness swell swings. Use it when tuning the detector in
//       # src/audio/features.ts: struck/dripping presets should fire on
//       # (nearly) every attack, drones almost never, and the counts must
//       # not collapse at a low frame rate.
//   node scripts/analyze.mjs --switch 0,3,10,7 [--at 20] [--wav shots/sw]
//       # preset switches through the live applyState path: plays each preset
//       # for --at seconds, then switches to the next; reports clicks
//       # (src/analysis/clicks.ts) around every switch and elsewhere
//
// Columns: score (0..1), envβ / cenβ (1/f^β of loudness / timbre contours,
// pink = 1), HFD (Higuchi dimension of the loudness contour), box
// (box-counting dimension of the spectrogram's loudest cells), dB.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseFlags, ensureServer, launchBrowser, captureErrors, openApp } from './lib.mjs';

const { flags } = parseFlags(process.argv.slice(2), ['preset', 'hash', 'secs', 'sr', 'mutants', 'random', 'wav', 'json', 'seed', 'configs', 'switch', 'at', 'fps']);
const SECS = Number(flags.get('secs') ?? 30);
const SR = Number(flags.get('sr') ?? 22050);
const MUTANTS = Number(flags.get('mutants') ?? 0);
const RANDOM = Number(flags.get('random') ?? 0);
const SEED = Number(flags.get('seed') ?? 1);

const { BASE, stop } = await ensureServer(false);
const errors = [];
const browser = await launchBrowser();
const page = await browser.newPage();
captureErrors(page, errors);
await openApp(page, `${BASE}/?res=64`);

// Build the candidate list in the page (the genome code is TypeScript).
const candidates = await page.evaluate(async ({ presetArg, hash, mutants, random, seed }) => {
  const { PRESETS } = await import('/src/presets.ts');
  const { decodeStateToken } = await import('/src/state/share.ts');
  const { stateToAppState } = await import('/src/state/schema.ts');
  const { encodeGenome, decodeGenome } = await import('/src/genome/codec.ts');
  const { randomGenome } = await import('/src/genome/evolve.ts');
  const { Explorer } = await import('/src/genome/explorer.ts');
  const { mulberry32 } = await import('/src/dsp/rng.ts');
  const rng = mulberry32(seed);
  const out = [];
  if (hash) {
    const p = decodeStateToken(hash);
    if (p) out.push({ group: 'hash', label: p.presetName ?? 'shared point', state: stateToAppState(p) });
  }
  const idx = presetArg ? presetArg.split(',').map(Number) : (hash ? [] : PRESETS.map((_, i) => i));
  for (const i of idx) {
    const p = PRESETS[i];
    if (!p) continue;
    out.push({ group: 'preset', label: `${i}: ${p.name}`, state: p.state });
    for (let m = 0; m < mutants; m++) {
      const ex = new Explorer(encodeGenome(p.state), { rng });
      const g = m % 2 === 0 ? ex.like() : (ex.like(), ex.dislike());
      out.push({ group: 'mutant', label: `  ${m % 2 === 0 ? '👍' : '👎'} of ${i}`, state: decodeGenome(g) });
    }
  }
  for (let r = 0; r < random; r++) {
    out.push({ group: 'random', label: `random ${r}`, state: decodeGenome(randomGenome(rng)) });
  }
  return JSON.parse(JSON.stringify(out));
}, { presetArg: flags.get('preset') ?? '', hash: flags.get('hash') ?? '', mutants: MUTANTS, random: RANDOM, seed: SEED });

const fmt = (v, d = 2) => (Number.isFinite(v) ? v.toFixed(d) : '  — ');
const pad = (s, n) => String(s).padEnd(n).slice(0, n);

async function renderScore(state, secs, sr) {
  return page.evaluate(async ({ state, secs, sr }) => {
    const { AudioEngine } = await import('/src/audio/engine.ts');
    const { analyzeSound } = await import('/src/analysis/fractal.ts');
    const samples = await AudioEngine.renderOffline(
      { masterGain: state.audio.masterGain, fx: state.audio.fx, formulas: state.audio.formulas, mod: state.mod },
      secs, sr,
    );
    return analyzeSound(samples, sr).score;
  }, { state, secs, sr });
}

function ranks(xs) {
  const idx = xs.map((v, i) => [v, i]).sort((a, b) => a[0] - b[0]);
  const r = new Array(xs.length);
  for (let i = 0; i < idx.length;) {
    let j = i;
    while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j++;
    for (let k = i; k <= j; k++) r[idx[k][1]] = (i + j) / 2;
    i = j + 1;
  }
  return r;
}

function spearman(a, b) {
  const ra = ranks(a), rb = ranks(b);
  const n = a.length;
  const ma = ra.reduce((x, y) => x + y, 0) / n, mb = rb.reduce((x, y) => x + y, 0) / n;
  let num = 0, da = 0, db = 0;
  for (let i = 0; i < n; i++) { num += (ra[i] - ma) * (rb[i] - mb); da += (ra[i] - ma) ** 2; db += (rb[i] - mb) ** 2; }
  return num / Math.sqrt(da * db);
}

if (flags.has('onsets')) {
  const fpsList = (flags.get('fps') ?? '60,30,15').split(',').map(Number);
  console.log(`${pad('preset', 22)} ${fpsList.map((f) => pad(`${f}fps`, 8)).join('')} swell        (${SECS}s @ ${SR} Hz)`);
  for (const c of candidates) {
    const r = await page.evaluate(async ({ state, secs, sr, fpsList }) => {
      const { AudioEngine } = await import('/src/audio/engine.ts');
      const { simulateAnalyser } = await import('/src/audio/analyserSim.ts');
      const { FeatureTracker, OnsetDetector } = await import('/src/audio/features.ts');
      const x = await AudioEngine.renderOffline(
        { masterGain: state.audio.masterGain, fx: state.audio.fx, formulas: state.audio.formulas, mod: state.mod },
        secs, sr,
      );
      return fpsList.map((fps) => {
        const tr = new FeatureTracker(sr);
        const det = new OnsetDetector();
        let hits = 0;
        let lo = 1;
        let hi = -1;
        for (const f of simulateAnalyser(x, sr, { fps })) {
          const feat = tr.update(f.timeDomain, f.bytes, 1 / fps);
          if (det.update(feat.onset, f.t)) hits++;
          if (f.t > 2) { lo = Math.min(lo, feat.swell); hi = Math.max(hi, feat.swell); }
        }
        return { fps, hits, lo, hi };
      });
    }, { state: c.state, secs: SECS, sr: SR, fpsList });
    const swell = `${fmt(r[0].lo)}…${fmt(r[0].hi)}`;
    console.log(`${pad(c.label, 22)} ${r.map((v) => pad(String(v.hits), 8)).join('')} ${swell}`);
  }
  await browser.close();
  stop();
  process.exit(errors.length ? 2 : 0);
}

if (flags.has('switch')) {
  const order = flags.get('switch').split(',').map(Number);
  const at = Number(flags.get('at') ?? 20);
  const r = await page.evaluate(async ({ order, at, sr }) => {
    const { AudioEngine } = await import('/src/audio/engine.ts');
    const { PRESETS } = await import('/src/presets.ts');
    const { detectClicks } = await import('/src/analysis/clicks.ts');
    const eng = (s) => ({ masterGain: s.audio.masterGain, fx: s.audio.fx, formulas: s.audio.formulas, mod: s.mod });
    const states = order.map((i) => PRESETS[i].state);
    const switches = states.slice(1).map((s, k) => ({ t: at * (k + 1), state: eng(s) }));
    const x = await AudioEngine.renderOffline(eng(states[0]), at * states.length, sr, switches);
    return { clicks: detectClicks(x, sr), names: order.map((i) => PRESETS[i].name) };
  }, { order, at, sr: SR });
  const near = (t) => r.clicks.filter((c) => c >= t - 0.05 && c <= t + 0.6);
  console.log(`switch chain: ${r.names.join(' → ')} (every ${at}s @ ${SR} Hz)`);
  for (let k = 1; k < order.length; k++) {
    console.log(`  at ${at * k}s  ${r.names[k - 1]} → ${r.names[k]}: ${near(at * k).length} click(s) ${JSON.stringify(near(at * k))}`);
  }
  const elsewhere = r.clicks.filter((c) => !order.slice(1).some((_, k) => c >= at * (k + 1) - 0.05 && c <= at * (k + 1) + 0.6));
  console.log('  elsewhere (not at a switch) — per preset; struck/plucked presets have real attacks here:');
  for (let k = 0; k < order.length; k++) {
    const inSeg = elsewhere.filter((c) => c >= at * k && c < at * (k + 1));
    console.log(`    ${r.names[k].padEnd(18)} ${String(inSeg.length).padStart(4)}  ${JSON.stringify(inSeg.slice(0, 8))}`);
  }
  await browser.close();
  stop();
  process.exit(errors.length ? 2 : 0);
}

if (flags.has('configs')) {
  const configs = flags.get('configs').split(',').map((c) => { const [secs, sr] = c.split('@').map(Number); return { secs, sr }; });
  console.log(`${pad('point', 34)} ${configs.map((c) => pad(`${c.secs}s@${c.sr}`, 11)).join(' ')}`);
  const table = configs.map(() => []);
  const times = configs.map(() => 0);
  for (const c of candidates) {
    const row = [];
    for (let k = 0; k < configs.length; k++) {
      const t0 = Date.now();
      const sc = await renderScore(c.state, configs[k].secs, configs[k].sr);
      times[k] += Date.now() - t0;
      table[k].push(sc);
      row.push(sc);
    }
    console.log(`${pad(c.label, 34)} ${row.map((v) => pad(fmt(v), 11)).join(' ')}`);
  }
  console.log('\nSpearman ρ vs the first window, mean render time:');
  for (let k = 0; k < configs.length; k++) {
    console.log(`  ${pad(`${configs[k].secs}s@${configs[k].sr}`, 11)} ρ=${spearman(table[0], table[k]).toFixed(2)}  ${(times[k] / candidates.length / 1000).toFixed(1)}s`);
  }
  await browser.close();
  stop();
  process.exit(errors.length ? 2 : 0);
}

console.log(`${pad('point', 34)} score  envβ   cenβ   HFD    box    dB    (${SECS}s @ ${SR} Hz)`);

const results = [];
for (const c of candidates) {
  const t0 = Date.now();
  const r = await page.evaluate(async ({ state, secs, sr, wantWav }) => {
    const { AudioEngine } = await import('/src/audio/engine.ts');
    const { analyzeSound } = await import('/src/analysis/fractal.ts');
    const samples = await AudioEngine.renderOffline(
      { masterGain: state.audio.masterGain, fx: state.audio.fx, formulas: state.audio.formulas, mod: state.mod },
      secs, sr,
    );
    const m = analyzeSound(samples, sr);
    let wav = null;
    if (wantWav) {
      const bytes = new Uint8Array(samples.length * 2);
      const dv = new DataView(bytes.buffer);
      for (let i = 0; i < samples.length; i++) dv.setInt16(i * 2, Math.max(-1, Math.min(1, samples[i])) * 32767, true);
      let bin = '';
      for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      wav = btoa(bin);
    }
    return { m, wav };
  }, { state: c.state, secs: SECS, sr: SR, wantWav: flags.has('wav') && c.group !== 'mutant' });
  const m = r.m;
  results.push({ group: c.group, label: c.label, ...m });
  console.log(`${pad(c.label, 34)} ${fmt(m.score)}   ${fmt(m.envBeta)}   ${fmt(m.centroidBeta)}   ${fmt(m.envHiguchi)}   ${fmt(m.boxDim)}   ${fmt(m.loudness, 0)}${m.silent ? '  SILENT' : ''}   ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  if (r.wav) {
    const dir = flags.get('wav');
    mkdirSync(dir, { recursive: true });
    const pcm = Buffer.from(r.wav, 'base64');
    const hdr = Buffer.alloc(44);
    hdr.write('RIFF', 0); hdr.writeUInt32LE(36 + pcm.length, 4); hdr.write('WAVE', 8);
    hdr.write('fmt ', 12); hdr.writeUInt32LE(16, 16); hdr.writeUInt16LE(1, 20); hdr.writeUInt16LE(1, 22);
    hdr.writeUInt32LE(SR, 24); hdr.writeUInt32LE(SR * 2, 28); hdr.writeUInt16LE(2, 32); hdr.writeUInt16LE(16, 34);
    hdr.write('data', 36); hdr.writeUInt32LE(pcm.length, 40);
    const name = c.label.replace(/[^\w]+/g, '_').replace(/^_|_$/g, '');
    writeFileSync(join(dir, `${name}.wav`), Buffer.concat([hdr, pcm]));
  }
}

const groups = [...new Set(results.map((r) => r.group))];
if (groups.length > 1) {
  console.log('\nmean score by group:');
  for (const g of groups) {
    const s = results.filter((r) => r.group === g).map((r) => r.score);
    const mean = s.reduce((a, b) => a + b, 0) / s.length;
    const sd = Math.sqrt(s.reduce((a, b) => a + (b - mean) ** 2, 0) / s.length);
    console.log(`  ${pad(g, 8)} n=${s.length}  ${mean.toFixed(3)} ± ${sd.toFixed(3)}`);
  }
}
if (flags.has('json')) writeFileSync(flags.get('json'), JSON.stringify(results, null, 2));

await browser.close();
stop();
if (errors.length) {
  console.error('errors:', errors);
  process.exit(2);
}
