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
//   node scripts/analyze.mjs --render [--grid 1024,512,256] [--scale 0,720]
//       [--size 1920x1080] [--preset 0] [--secs 6]
//       # FRAMES PER SECOND of the real rAF loop (not sound): opens the app
//       # per configuration and counts presented frames. The only number the
//       # rendering work is judged by — a per-pass breakdown from JS is not
//       # available (the raster happens in the GPU process, so a finish()
//       # around drawArrays reports ~0). Software rasterizer here, so treat
//       # the absolute value as this machine's, and compare configurations
//   node scripts/analyze.mjs --render --passes [--grid 1024] [--size 1920x1080]
//       # milliseconds per PASS, not per frame. A gl.finish() around
//       # drawArrays reports ~0 (the raster happens in the GPU process), but
//       # a 1-pixel readPixels is a real barrier: every queued command must
//       # complete first. Timing step() at speed 1 and at speed 11 separates
//       # one Gray-Scott substep from the fields+advect block around it.
//   node scripts/analyze.mjs --switch 0,3,10,7 [--at 20] [--wav shots/sw]
//       # preset switches through the live applyState path: plays each preset
//       # for --at seconds, then switches to the next; reports clicks
//       # (src/analysis/clicks.ts) around every switch and elsewhere
//
//   node scripts/analyze.mjs --picture --preset 13,14 [--minutes 5] [--every 30] [--res 128]
//       # numbers for the PICTURE (PLAN.md #22): each preset plays with sound
//       # in its own page, and every --every seconds the simulation's V
//       # channel is read back: coverage (share of the canvas holding
//       # pattern), edges (how intricate), change (mean |ΔV| since the last
//       # sample). Flags a pattern that died or froze. Real time, and this
//       # machine draws a few fps, so the pattern evolves slower than on a
//       # phone: compare presets with each other, not with a device
//   node scripts/analyze.mjs --preset 12 --repeat 4 [--wav shots/wav]
//       # render each point in 4 rooms, print mean ± sd: render k uses seed k
//       # (src/audio/seed.ts — the reverb room and the noise formulas) for
//       # EVERY point, so points compare as pairs. A point on the steep side
//       # of a preference curve moves by ±0.1 between rooms. With --wav, each
//       # seed's WAVs land in <dir>/seed<k>/. One seed renders identically
//       # every time (seed 1 is what the app plays)
//   node scripts/analyze.mjs --preset 12 --secs 60 --png shots/png
//       # + a picture of every render: log-frequency waterfall (30 Hz – 12 kHz,
//       # 72 dB, brighter = louder) over the RMS loudness curve. An agent can't
//       # hear, but it can read the image (PLAN.md #22). With --repeat, one per
//       # seed in <dir>/seed<k>/; mutants are drawn too
//   node scripts/analyze.mjs --character --ref 0,3,5,6,8 --preset 0,3,5,6,8,12
//       # + character columns (src/analysis/character.ts: dropout, swing,
//       # low-end share, harmonicity, roughness, motion at 1 s / 10 s) and
//       # each point's distance to the --ref group of presets
//
// Columns: score (0..1), envβ / cenβ (1/f^β of loudness / timbre contours,
// pink = 1), HFD (Higuchi dimension of the loudness contour), box
// (box-counting dimension of the spectrogram's loudest cells), dB.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseFlags, startServer, launchBrowser, captureErrors, openApp, withParam } from './lib.mjs';

const { flags } = parseFlags(process.argv.slice(2), ['preset', 'hash', 'secs', 'sr', 'mutants', 'random', 'wav', 'json', 'seed', 'configs', 'switch', 'at', 'fps', 'grid', 'scale', 'size', 'warm', 'reps', 'repeat', 'ref', 'png', 'minutes', 'every', 'res']);
const SECS = Number(flags.get('secs') ?? 30);
const SR = Number(flags.get('sr') ?? 22050);
const MUTANTS = Number(flags.get('mutants') ?? 0);
const RANDOM = Number(flags.get('random') ?? 0);
const SEED = Number(flags.get('seed') ?? 1);

const fmt = (v, d = 2) => (Number.isFinite(v) ? v.toFixed(d) : '  — ');
const pad = (s, n) => String(s).padEnd(n).slice(0, n);

const { BASE, stop } = await startServer(false);
const errors = [];
const browser = await launchBrowser();

// --render: how many frames a second the app actually paints. Its own branch
// because every configuration needs its own window size, which means its own
// browser context — the other modes share one page and never draw.
if (flags.has('render') && flags.has('passes')) {
  const [w, h] = (flags.get('size') ?? '1920x1080').split('x').map(Number);
  const grids = (flags.get('grid') ?? '1024,512,256').split(',').map(Number);
  const preset = Number(flags.get('preset') ?? 0);
  const reps = Number(flags.get('reps') ?? 4);
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
  const pp = await ctx.newPage();
  captureErrors(pp, errors, () => 'passes');
  await openApp(pp, `${BASE}/?res=64`);
  await pp.waitForTimeout(6000); // let the GPU process JIT the shaders (see --render)
  console.log(`per pass, ms — canvas ${w}x${h}, preset ${preset}, mean of ${reps}`);
  console.log(`${pad('res', 6)} ${pad('grid', 11)} ${pad('fields', 9)} ${pad('react×1', 9)} ${pad('react×N', 10)} ${pad('display', 9)} frame at this preset's speed`);
  for (const res of grids) {
    const r = await pp.evaluate(async ({ res, w, h, preset, reps }) => {
      const { SimEngine } = await import('/src/sim/engine.ts');
      const { gridSize } = await import('/src/sim/grid.ts');
      const { reactionParamsFromCard, fieldVariationParamsFromCard, flowParamsFromCard, ZERO_FIELD_VARIATION, ZERO_FLOW } = await import('/src/sim/params.ts');
      const { composePalette, palettesByIndex } = await import('/src/palette.ts');
      const { PRESETS } = await import('/src/presets.ts');
      const cards = PRESETS[preset].state.visual.cards;
      const cv = document.createElement('canvas');
      cv.width = w;
      cv.height = h;
      const g = gridSize(res, w, h);
      const sim = new SimEngine({ canvas: cv, ...g });
      sim.reaction = reactionParamsFromCard(cards.reaction.params);
      sim.fieldVariation = cards.fieldVariation.on ? fieldVariationParamsFromCard(cards.fieldVariation.params) : { ...ZERO_FIELD_VARIATION };
      sim.flow = cards.flow.on ? flowParamsFromCard(cards.flow.params) : { ...ZERO_FLOW };
      const p = cards.palette.params;
      const pal = composePalette(palettesByIndex(p.paletteId), p.shift, p.contrast, p.bands, p.relief, p.lightAngle, p.gloss);
      // GL commands run in order, so a readPixels forces everything queued
      // before it to finish. Read a 1x1 FBO of our own, never the default
      // framebuffer — that one resolves the whole swap chain and costs more
      // than the pass being measured.
      const gl = sim.gl;
      const px = new Uint8Array(4);
      const dot = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, dot);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      const dotFbo = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, dotFbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, dot, 0);
      const barrier = () => {
        gl.bindFramebuffer(gl.FRAMEBUFFER, dotFbo);
        gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
      };
      const time = (fn) => {
        fn();
        barrier();
        const t0 = performance.now();
        for (let i = 0; i < reps; i++) fn();
        barrier();
        return (performance.now() - t0) / reps;
      };
      const step = (speed) => time(() => { sim.reaction.speed = speed; sim.step(); });
      const floor = time(() => {}); // what the barrier itself adds to every row
      const s1 = step(1);
      const s11 = step(11);
      const react = (s11 - s1) / 10;
      const display = time(() => sim.render(pal));
      return { grid: `${g.width}x${g.height}`, fields: s1 - react - floor, react, display: display - floor, floor, speed: Math.max(1, Math.round(sim.reaction.speed)) };
    }, { res, w, h, preset, reps });
    const frame = r.fields + r.react * r.speed + r.display;
    console.log(`${pad(res, 6)} ${pad(r.grid, 11)} ${pad(fmt(r.fields, 1), 9)} ${pad(fmt(r.react, 1), 9)} ${pad(fmt(r.react * r.speed, 1), 10)} ${pad(fmt(r.display, 1), 9)} ${fmt(frame, 0)} ms = ${fmt(1000 / frame)} fps  (×${r.speed} substeps, barrier ±${fmt(r.floor, 1)})`);
  }
  await ctx.close();
  await browser.close();
  stop();
  if (errors.length) console.error('errors:', errors);
  process.exit(errors.length ? 2 : 0);
}

if (flags.has('render')) {
  const sizes = (flags.get('size') ?? '1920x1080').split(',');
  const grids = (flags.get('grid') ?? '1024,512,256').split(',').map(Number);
  const scales = (flags.get('scale') ?? '0').split(',').map(Number);
  const preset = Number(flags.get('preset') ?? 0);
  const secs = Number(flags.get('secs') ?? 6);
  const warm = Number(flags.get('warm') ?? 3);
  // THROW THE FIRST CONFIGURATION AWAY. The first page to render in a fresh
  // browser measures ~8x slower than every later one at the identical
  // configuration (SwiftShader JIT-compiles the shaders in the GPU process,
  // which outlives the tab), and no amount of warm-up inside the page covers
  // it. Measured: 1024 @ 1920x1080 reads 0.29 fps first, then 2.73, 2.36,
  // 2.53 — so a run that does not do this compares its first row against
  // everything else.
  {
    const ctx = await browser.newContext({ viewport: { width: 640, height: 400 }, deviceScaleFactor: 1 });
    const wp = await ctx.newPage();
    await openApp(wp, `${BASE}/?preset=${preset}&res=256`);
    await wp.waitForTimeout(6000);
    await ctx.close();
  }
  for (const size of sizes) {
    const [w, h] = size.split('x').map(Number);
    console.log(`window ${w}x${h}, preset ${preset}, ${secs}s measured after ${warm}s warm-up`);
    console.log(`${pad('res', 6)} ${pad('scale', 7)} ${pad('canvas', 11)} ${pad('grid', 11)} ${pad('fps', 7)} ${pad('mean ms', 9)} p95 ms`);
    for (const res of grids) {
      for (const scale of scales) {
        const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
        const rp = await ctx.newPage();
        captureErrors(rp, errors, () => `${res}@${size}+${scale}`);
        let url = withParam(`${BASE}/?preset=${preset}`, 'res', res);
        url = withParam(url, 'scale', scale);
        await openApp(rp, url);
        const r = await rp.evaluate(async ({ secs, warm }) => {
          const c = document.getElementById('view');
          // The same context the app draws with (getContext returns the live
          // one). Counting rAF callbacks alone measures how fast the main
          // thread ENQUEUES frames, not how fast they are rasterized — the
          // passes run in the GPU process, so the loop races ahead and the
          // identical configuration reads as 0.3 fps or 2.9 fps depending on
          // how deep the queue is. gl.finish() does NOT fix that here (it
          // returns without the raster having happened); a 1-pixel
          // readPixels does, because it has to hand back real pixels.
          const gl = c.getContext('webgl2');
          const px = new Uint8Array(4);
          const drain = gl
            ? () => {
              gl.bindFramebuffer(gl.FRAMEBUFFER, null);
              gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
            }
            : () => {};
          const wait = (ms) => new Promise((done) => {
            const t0 = performance.now();
            const tick = () => {
              drain();
              return performance.now() - t0 >= ms ? done() : requestAnimationFrame(tick);
            };
            requestAnimationFrame(tick);
          });
          await wait(warm * 1000);
          const dts = await new Promise((done) => {
            const out = [];
            let prev = performance.now();
            const t0 = prev;
            const tick = () => {
              drain();
              const now = performance.now();
              out.push(now - prev);
              prev = now;
              if (now - t0 >= secs * 1000) done(out);
              else requestAnimationFrame(tick);
            };
            requestAnimationFrame(tick);
          });
          return { dts, canvas: `${c.width}x${c.height}`, grid: document.body.dataset.grid ?? '?', synced: !!gl };
        }, { secs, warm });
        const dts = r.dts.slice().sort((a, b) => a - b);
        const mean = r.dts.reduce((a, b) => a + b, 0) / r.dts.length;
        const p95 = dts[Math.min(dts.length - 1, Math.floor(dts.length * 0.95))];
        console.log(`${pad(res, 6)} ${pad(scale || 'off', 7)} ${pad(r.canvas, 11)} ${pad(r.grid, 11)} ${pad(fmt(1000 / mean), 7)} ${pad(fmt(mean, 0), 9)} ${fmt(p95, 0)}${r.synced ? '' : '  (NOT GPU-synced)'}`);
        await ctx.close();
      }
    }
  }
  await browser.close();
  stop();
  if (errors.length) console.error('errors:', errors);
  process.exit(errors.length ? 2 : 0);
}

if (flags.has('picture')) {
  const minutes = Number(flags.get('minutes') ?? 5);
  const every = Number(flags.get('every') ?? 30);
  const res = Number(flags.get('res') ?? 128);
  const presets = (flags.get('preset') ?? '0').split(',').map(Number);
  console.log(`picture, grid ${res}, sampled every ${every}s for ${minutes} min — cov: share holding pattern, edges: share on a boundary, chg: mean |ΔV|`);
  const runs = await Promise.all(presets.map(async (i) => {
    // a context (window) each: every page keeps drawing
    const ctx = await browser.newContext({ viewport: { width: 640, height: 400 } });
    const pg = await ctx.newPage();
    captureErrors(pg, errors, () => `picture ${i}`);
    await openApp(pg, `${BASE}/?preset=${i}&res=${res}&probe=1&scout=0`);
    await pg.locator('#audioBtn').click();
    const name = await pg.locator('#pointsBtn').textContent();
    const samples = [];
    for (let t = every; t <= minutes * 60; t += every) {
      await pg.waitForTimeout(every * 1000);
      samples.push({ t, ...await pg.evaluate(async () => {
        const { pictureMetrics } = await import('/src/analysis/picture.ts');
        const s = window.synesthesiaProbe();
        const m = pictureMetrics(s.v, s.width, s.height, window.__prevV);
        window.__prevV = s.v;
        return m;
      }) });
    }
    await ctx.close();
    return { name: name.trim(), samples };
  }));
  for (const r of runs) {
    const col = (k, d) => r.samples.map((m) => pad(fmt(m[k], d), 6)).join('');
    const died = r.samples.find((m) => !m.alive);
    const frozen = r.samples.slice(1).find((m) => m.change < 1e-4);
    console.log(`\n${r.name}${died ? `  DIED by ${died.t}s` : ''}${frozen ? `  FROZE by ${frozen.t}s` : ''}`);
    console.log(`  t      ${r.samples.map((m) => pad(`${m.t}s`, 6)).join('')}`);
    console.log(`  cov    ${col('coverage', 2)}`);
    console.log(`  edges  ${col('edges', 2)}`);
    console.log(`  chg    ${col('change', 3)}`);
  }
  await browser.close();
  stop();
  if (errors.length) console.error('errors:', errors);
  process.exit(errors.length ? 2 : 0);
}

const page = await browser.newPage();
captureErrors(page, errors);
// The page is the app itself, and its rAF loop kept painting while audio
// rendered offline: at the default canvas the GPU process took ~2.5 cores
// for a picture nobody looks at. ?paused=1 never starts the loop; the 64 px
// canvas stays so a page without the flag (an older checkout) is still cheap.
await openApp(page, `${BASE}/?res=64&scale=64&paused=1`);

// Build the candidate list in the page (the genome code is TypeScript).
const candidates = await page.evaluate(async ({ presetArg, hash, mutants, random, seed }) => {
  // A TEMPORARY `export const VARIANTS` in presets.ts (drafts of a preset
  // being designed) renders after the built-ins: --preset 13,14,… — the
  // new-preset skill's loop. tests/presets.test.ts fails if one is committed.
  const { PRESETS: BUILT_IN, VARIANTS = [] } = await import('/src/presets.ts');
  const PRESETS = [...BUILT_IN, ...VARIANTS];
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

/** A point's label as a file name (WAVs and PNGs share it). */
const fileName = (label) => label.replace(/[^\w]+/g, '_').replace(/^_|_$/g, '');

// --png: drawn in the page (canvas), returned as base64. Sequential magnitude
// = one hue, dark → light on a dark surface (the dataviz skill's blue ramp);
// grid and labels stay recessive and neutral.
async function drawRenderPng(samples, sr, title) {
  const { logSpectrogram } = await import('/src/analysis/spectrogram.ts');
  const W = 1200, SPEC_H = 320, LOUD_H = 90, L = 52, R = 14, TOP = 26, GAP = 14, BOTTOM = 22;
  const sp = logSpectrogram(samples, sr, { columns: W, rows: SPEC_H });
  const cv = document.createElement('canvas');
  cv.width = L + W + R;
  cv.height = TOP + SPEC_H + GAP + LOUD_H + BOTTOM;
  const g = cv.getContext('2d');
  const SURFACE = '#14161a', INK = '#e6e8eb', MUTED = '#9aa0a8', GRID = 'rgba(255,255,255,0.16)', LINE = '#6da7ec';
  g.fillStyle = SURFACE;
  g.fillRect(0, 0, cv.width, cv.height);
  // blue ramp 700 → 100, then white: quiet recedes into the surface
  const stops = ['#14161a', '#0d366b', '#1c5cab', '#3987e5', '#86b6ef', '#cde2fb', '#ffffff'].map((h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)));
  let top = -Infinity;
  for (const v of sp.db) top = Math.max(top, v);
  const RANGE = 72;
  const img = g.createImageData(W, SPEC_H);
  for (let i = 0; i < sp.db.length; i++) {
    const u = Math.max(0, Math.min(1, (sp.db[i] - (top - RANGE)) / RANGE)) * (stops.length - 1);
    const k = Math.min(stops.length - 2, Math.floor(u));
    const f = u - k;
    for (let ch = 0; ch < 3; ch++) img.data[i * 4 + ch] = stops[k][ch] + (stops[k + 1][ch] - stops[k][ch]) * f;
    img.data[i * 4 + 3] = 255;
  }
  g.putImageData(img, L, TOP);
  g.font = '12px sans-serif';
  g.textBaseline = 'middle';
  // frequency grid: row of a frequency = inverse of rowHz
  const fMax = sp.rowHz(0), fMin = sp.rowHz(SPEC_H - 1);
  const rowOf = (hz) => ((SPEC_H - 1) * Math.log(fMax / hz)) / Math.log(fMax / fMin);
  for (const hz of [50, 100, 200, 500, 1000, 2000, 5000, 10000]) {
    if (hz < fMin || hz > fMax) continue;
    const y = TOP + rowOf(hz) + 0.5;
    g.strokeStyle = GRID;
    g.lineWidth = 1;
    g.beginPath(); g.moveTo(L, y); g.lineTo(L + W, y); g.stroke();
    g.fillStyle = MUTED;
    g.textAlign = 'right';
    g.fillText(hz >= 1000 ? `${hz / 1000}k` : String(hz), L - 6, y);
  }
  // loudness strip, 10 dB grid
  const lo = Math.min(...sp.loudness), hi = Math.max(...sp.loudness);
  let yMax = Math.ceil(hi / 10) * 10, yMin = Math.floor(lo / 10) * 10;
  if (yMax - yMin < 20) yMin = yMax - 20;
  yMin = Math.max(yMin, yMax - 60);
  const loudTop = TOP + SPEC_H + GAP;
  const yOf = (db) => loudTop + (LOUD_H * (yMax - Math.max(yMin, db))) / (yMax - yMin);
  for (let db = yMin; db <= yMax; db += 10) {
    const y = Math.round(yOf(db)) + 0.5;
    g.strokeStyle = GRID;
    g.beginPath(); g.moveTo(L, y); g.lineTo(L + W, y); g.stroke();
    g.fillStyle = MUTED;
    g.textAlign = 'right';
    g.fillText(String(db), L - 6, y);
  }
  g.strokeStyle = LINE;
  g.lineWidth = 2;
  g.lineJoin = 'round';
  g.beginPath();
  for (let c = 0; c < W; c++) (c ? g.lineTo : g.moveTo).call(g, L + c + 0.5, yOf(sp.loudness[c]));
  g.stroke();
  // time axis
  const secs = samples.length / sr;
  const step = secs > 120 ? 30 : secs > 30 ? 10 : 5;
  g.fillStyle = MUTED;
  g.textAlign = 'center';
  for (let t = 0; t <= secs; t += step) {
    const x = L + (W * t) / secs;
    g.strokeStyle = GRID;
    g.lineWidth = 1;
    g.beginPath(); g.moveTo(x + 0.5, TOP); g.lineTo(x + 0.5, TOP + SPEC_H); g.stroke();
    g.fillText(`${t}s`, x, cv.height - BOTTOM / 2);
  }
  g.textAlign = 'left';
  g.fillStyle = INK;
  g.fillText(title, L, TOP / 2);
  g.fillStyle = MUTED;
  g.textAlign = 'right';
  g.fillText('Hz · brighter = louder (72 dB)   |   RMS dBFS below', L + W, TOP / 2);
  return cv.toDataURL('image/png').split(',')[1];
}

function writePng(dir, name, b64) {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${name}.png`), Buffer.from(b64, 'base64'));
}

/** 16-bit mono WAV of base64 PCM, named after the point's label. */
function writeWav(dir, label, b64) {
  mkdirSync(dir, { recursive: true });
  const pcm = Buffer.from(b64, 'base64');
  const hdr = Buffer.alloc(44);
  hdr.write('RIFF', 0); hdr.writeUInt32LE(36 + pcm.length, 4); hdr.write('WAVE', 8);
  hdr.write('fmt ', 12); hdr.writeUInt32LE(16, 16); hdr.writeUInt16LE(1, 20); hdr.writeUInt16LE(1, 22);
  hdr.writeUInt32LE(SR, 24); hdr.writeUInt32LE(SR * 2, 28); hdr.writeUInt16LE(2, 32); hdr.writeUInt16LE(16, 34);
  hdr.write('data', 36); hdr.writeUInt32LE(pcm.length, 40);
  writeFileSync(join(dir, `${fileName(label)}.wav`), Buffer.concat([hdr, pcm]));
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

// --repeat N: the room (reverb impulse) moves the score — 0.28 vs 0.52 for
// one point. Render k uses seed k for every point: N paired rooms, mean ± sd.
const REPEAT = Math.max(1, Number(flags.get('repeat') ?? 1));
const CHARACTER_KEYS = ['dropout', 'swing', 'lowShare', 'harmonicity', 'roughness', 'motion1s', 'motion10s'];
const METRIC_KEYS = ['score', 'envBeta', 'centroidBeta', 'envHiguchi', 'boxDim', 'loudness', ...CHARACTER_KEYS];
const CHARACTER = flags.has('character') || flags.has('ref');
const meanOf = (xs) => { const f = xs.filter(Number.isFinite); return f.length ? f.reduce((a, b) => a + b, 0) / f.length : NaN; };
const sdOf = (xs) => { const m = meanOf(xs); const f = xs.filter(Number.isFinite); return f.length ? Math.sqrt(f.reduce((a, b) => a + (b - m) ** 2, 0) / f.length) : NaN; };
const charHead = CHARACTER ? 'drop  swing low   harm  rough mot1  mot10 ' : '';
console.log(`${pad('point', 34)} ${REPEAT > 1 ? 'score±sd    ' : 'score  '}envβ   cenβ   HFD    box    dB    ${charHead}(${SECS}s @ ${SR} Hz${REPEAT > 1 ? `, mean of ${REPEAT} renders` : ''})`);

const results = [];
const PNG_SOURCE = `(${drawRenderPng.toString()})`;
for (const [ci, c] of candidates.entries()) {
  const t0 = Date.now();
  const runs = [];
  let wavB64 = null;
  for (let rep = 0; rep < REPEAT; rep++) {
    const r = await page.evaluate(async ({ state, secs, sr, wantWav, seed, pngSource, label }) => {
      const { AudioEngine } = await import('/src/audio/engine.ts');
      const { analyzeSound } = await import('/src/analysis/fractal.ts');
      const { analyzeCharacter } = await import('/src/analysis/character.ts');
      const samples = await AudioEngine.renderOffline(
        { masterGain: state.audio.masterGain, fx: state.audio.fx, formulas: state.audio.formulas, mod: state.mod },
        secs, sr, [], seed,
      );
      const m = { ...analyzeSound(samples, sr), ...analyzeCharacter(samples, sr) };
      let png = null;
      if (pngSource) {
        const draw = (0, eval)(pngSource);
        png = await draw(samples, sr, `${label.trim()}  ·  ${secs} s @ ${sr} Hz  ·  seed ${seed}  ·  score ${m.score.toFixed(2)}`);
      }
      let wav = null;
      if (wantWav) {
        const bytes = new Uint8Array(samples.length * 2);
        const dv = new DataView(bytes.buffer);
        for (let i = 0; i < samples.length; i++) dv.setInt16(i * 2, Math.max(-1, Math.min(1, samples[i])) * 32767, true);
        let bin = '';
        for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
        wav = btoa(bin);
      }
      return { m, wav, png };
    }, { state: c.state, secs: SECS, sr: SR, wantWav: flags.has('wav') && c.group !== 'mutant' && (rep === 0 || REPEAT > 1), seed: rep + 1, pngSource: flags.has('png') ? PNG_SOURCE : null, label: c.label });
    if (r.png) {
      const name = c.group === 'mutant' ? `${fileName(c.label)}_${ci}` : fileName(c.label);
      writePng(REPEAT > 1 ? join(flags.get('png'), `seed${rep + 1}`) : flags.get('png'), name, r.png);
    }
    runs.push(r.m);
    if (r.wav && REPEAT > 1) writeWav(join(flags.get('wav'), `seed${rep + 1}`), c.label, r.wav);
    else if (r.wav) wavB64 = r.wav;
  }
  const m = { ...runs[0] };
  for (const k of METRIC_KEYS) m[k] = meanOf(runs.map((x) => x[k]));
  if (REPEAT > 1) {
    m.scoreSd = sdOf(runs.map((x) => x.score));
    m.seedScores = runs.map((x) => x.score); // render k = seed k+1, paired across points
  }
  const scoreCol = REPEAT > 1 ? `${fmt(m.score)}±${fmt(m.scoreSd)}  ` : fmt(m.score);
  results.push({ group: c.group, label: c.label, ...m });
  const charCols = CHARACTER
    ? `  ${[m.dropout, m.swing].map((v) => pad(fmt(v, 1), 5)).join(' ')} ${[m.lowShare, m.harmonicity, m.roughness].map((v) => pad(fmt(v), 5)).join(' ')} ${[m.motion1s, m.motion10s].map((v) => pad(fmt(v, 1), 5)).join(' ')}`
    : '';
  console.log(`${pad(c.label, 34)} ${scoreCol}   ${fmt(m.envBeta)}   ${fmt(m.centroidBeta)}   ${fmt(m.envHiguchi)}   ${fmt(m.boxDim)}   ${fmt(m.loudness, 0)}${charCols}${m.silent ? '  SILENT' : ''}   ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  if (wavB64) writeWav(flags.get('wav'), c.label, wavB64);
}

// --ref 0,3,5,6,8: how far each point sits from a reference group of
// presets (e.g. the ones people liked most) — per metric z-scores against
// the group's mean/sd, RMS over the metrics. The group members must be in
// this run (list them in --preset too). A new preset near ~1 is inside the
// family's spread; the list of metrics beyond 2 sd says WHERE it differs.
if (flags.has('ref')) {
  const refIdx = flags.get('ref').split(',').map(Number);
  const refs = results.filter((r) => refIdx.some((i) => r.label.startsWith(`${i}: `)));
  const keys = ['envBeta', 'centroidBeta', 'boxDim', ...CHARACTER_KEYS];
  const stat = Object.fromEntries(keys.map((k) => {
    const xs = refs.map((r) => r[k]);
    // a floor on sd: a family that happens to agree on a metric must not
    // turn a tiny difference into a huge z
    const floor = { envBeta: 0.15, centroidBeta: 0.15, boxDim: 0.05, dropout: 1, swing: 2, lowShare: 0.05, harmonicity: 0.05, roughness: 0.02, motion1s: 0.3, motion10s: 0.5 }[k];
    return [k, { mean: meanOf(xs), sd: Math.max(floor, sdOf(xs)) }];
  }));
  console.log(`\ndistance to the reference group (${refs.map((r) => r.label).join(', ')}):`);
  console.log(`  ${keys.map((k) => `${k} ${fmt(stat[k].mean)}±${fmt(stat[k].sd)}`).join('  ')}`);
  for (const r of results) {
    const zs = keys.map((k) => [k, (r[k] - stat[k].mean) / stat[k].sd]).filter(([, z]) => Number.isFinite(z));
    const d = Math.sqrt(zs.reduce((a, [, z]) => a + z * z, 0) / Math.max(1, zs.length));
    const far = zs.filter(([, z]) => Math.abs(z) > 2).map(([k, z]) => `${k}${z > 0 ? '+' : ''}${z.toFixed(1)}`);
    console.log(`  ${pad(r.label, 32)} ${fmt(d)}  ${far.join(' ')}`);
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
