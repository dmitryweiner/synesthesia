#!/usr/bin/env node
// What only a browser can measure: the picture's frame rate on the real rAF
// loop, the GPU passes one by one, and the picture over minutes. The sound
// is measured by synesthesia-core's syn-bench (PLAN-CORE.md C6) — the old
// sound flags here print where to go.
//
//   node scripts/analyze.mjs --render [--grid 1024,512,256] [--scale 0,720]
//       [--size 1920x1080] [--preset 0] [--secs 6]
//       # FRAMES PER SECOND of the real rAF loop per configuration (--grid 0
//       # = let the boot probe choose, and see what it chose). Software
//       # rasterizer here: compare configurations, not devices
//   node scripts/analyze.mjs --render --passes [--grid 1024] [--size 1920x1080]
//       # milliseconds per PASS: a 1-pixel readPixels is a real barrier
//       # (gl.finish() is not); timing step() at 1 and 11 substeps splits one
//       # Gray-Scott substep from the fields + advect around it
//   node scripts/analyze.mjs --picture --preset 13,14 [--minutes 5] [--every 30] [--res 128]
//       # numbers for the PICTURE (PLAN.md #22): coverage, edges, change of
//       # the simulation's V channel every --every seconds; flags a pattern
//       # that died or froze
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
      // the app's picture: the core's driver on the preset (PLAN-CORE.md phase 5)
      const { SimEngine } = await import('/src/sim/engine.ts');
      const { initCore } = await import('/src/core/session.ts');
      const { WebPicture, gridFor, parseFrame, parseSeed } = await import('/src/core/picture.ts');
      const { presetStateJson } = await import('/src/core/pkg/syn_wasm.js');
      await initCore();
      const cv = document.createElement('canvas');
      cv.width = w;
      cv.height = h;
      const g = gridFor(res, w, h);
      const sim = new SimEngine({ canvas: cv, ...g });
      const pic = new WebPicture(1, presetStateJson(preset) ?? '', false, 0);
      sim.reseed(parseSeed(pic.reseed()));
      const frame = { ...parseFrame(pic.frame(0, new Float64Array(0), sim.aspect)), injects: [] };
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
      const step = (speed) => time(() => sim.step({ ...frame, reaction: { ...frame.reaction, substeps: speed } }));
      const floor = time(() => {}); // what the barrier itself adds to every row
      const s1 = step(1);
      const s11 = step(11);
      const react = (s11 - s1) / 10;
      const display = time(() => sim.render(frame));
      return { grid: `${g.width}x${g.height}`, fields: s1 - react - floor, react, display: display - floor, floor, speed: Math.max(1, frame.reaction.substeps) };
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
        // the core's metric (syn_core::analysis::picture), on the GPU's field
        const { pictureMetrics } = await import('/src/core/pkg/syn_wasm.js');
        const s = window.synesthesiaProbe();
        const m = JSON.parse(pictureMetrics(s.v, s.width, s.height, window.__prevV ?? new Float32Array(0)));
        if (m.change === null) m.change = NaN;
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

// The sound modes (fractality, --repeat, --mutants/--random, --character /
// --ref, --wav, --png, --onsets, --switch, --configs) moved to the core with
// the sound (PLAN-CORE.md C6): synesthesia-core's syn-bench, the same flags.
console.error(`analyze.mjs measures the platform: --render, --render --passes, --picture.
The sound is measured by the core's bench, without a browser:
  cd ../synesthesia-core && cargo run --release -p syn-bench -- ${process.argv.slice(2).join(' ')}`);
await browser.close();
stop();
process.exit(1);
