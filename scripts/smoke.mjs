#!/usr/bin/env node
// Browser smoke test — the only way to exercise WebGL2 + Web Audio (vitest
// can't load them). Boots the app, starts sound, presses every feedback
// button, undoes, loads every preset, saves a point and reloads it, opens a
// share link in a second tab. Fails on any console/page error or broken
// invariant; checks invariants only, never pixels.
//
//   node scripts/smoke.mjs [--preview] [--mobile] [--res 128] [--screenshot shots/smoke.png]
//
// --res sets the simulation grid (default 128): headless Chromium renders
// WebGL through SwiftShader, and a 1024² grid starves the CPU enough for a
// second tab's navigation to time out.
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { parseFlags, ensureServer, launchBrowser, captureErrors, openApp, withRes } from './lib.mjs';

const { flags } = parseFlags(process.argv.slice(2), ['screenshot', 'res']);
const RES = Number(flags.get('res') ?? 128);
const { BASE, stop } = await ensureServer(flags.has('preview'));

const errors = [];
let ctxLabel = 'boot';
const browser = await launchBrowser();
const context = await browser.newContext({
  viewport: flags.has('mobile') ? { width: 390, height: 844 } : { width: 1280, height: 820 },
  permissions: ['clipboard-read', 'clipboard-write'],
});
const page = await context.newPage();
captureErrors(page, errors, () => ctxLabel);

function check(cond, msg) {
  if (!cond) errors.push(`[${ctxLabel}] ${msg}`);
}

const statusText = async (p = page) => (await p.locator('#status').textContent()) ?? '';
const hashOf = (p = page) => p.evaluate(() => location.hash);
const MORPH_WAIT = 2400; // > MORPH_SECONDS in main.ts

await openApp(page, withRes(BASE, RES), { keepHelp: true });
check(await page.locator('#help').isVisible(), 'help dialog should open on first visit');
await page.locator('#helpCloseBtn').click();
check((await statusText()).includes('Fractal garden'), 'default preset is not Fractal garden');
check((await hashOf()).startsWith('#s='), 'URL hash does not carry the point');
check(await page.locator('#webglError').isHidden(), 'WebGL error shown');

// --- sound ---
ctxLabel = 'audio';
await page.locator('#audioBtn').click();
await page.waitForTimeout(1500);
check(((await page.locator('#audioBtn').textContent()) ?? '').includes('⏹'), 'audio did not start');

// --- feedback loop ---
ctxLabel = 'like';
const hash0 = await hashOf();
await page.locator('#likeBtn').click();
await page.waitForTimeout(300);
check((await statusText()).includes('continuing'), 'like status missing');
await page.waitForTimeout(MORPH_WAIT);
check((await hashOf()) !== hash0, 'hash unchanged after like');
check(!(await page.locator('#undoBtn').isDisabled()), 'undo should be enabled after like');

ctxLabel = 'dislike';
await page.locator('#dislikeBtn').click();
await page.waitForTimeout(300);
check((await statusText()).includes('back to the last liked'), 'dislike status missing');

ctxLabel = 'keyboard';
await page.keyboard.press('ArrowRight');
await page.waitForTimeout(200);
check((await statusText()).includes('step 3'), `ArrowRight did not step: "${await statusText()}"`);

ctxLabel = 'surprise';
await page.locator('#surpriseBtn').click();
await page.waitForTimeout(300);
check((await statusText()).includes('jumped'), 'surprise status missing');

ctxLabel = 'undo';
const depthText = (await page.locator('#undoBtn').textContent()) ?? '';
check(depthText.includes('(4)'), `undo depth should be 4, got "${depthText}"`);
await page.locator('#undoBtn').click();
await page.waitForTimeout(200);
check((await statusText()).includes('undone'), 'undo status missing');
for (let i = 0; i < 5; i++) {
  if (await page.locator('#undoBtn').isDisabled()) break;
  await page.locator('#undoBtn').click();
  await page.waitForTimeout(100);
}
check(await page.locator('#undoBtn').isDisabled(), 'undo should be disabled once history is empty');

// --- history depth caps at 5 ---
ctxLabel = 'history-cap';
for (let i = 0; i < 7; i++) {
  await page.locator(i % 2 ? '#likeBtn' : '#dislikeBtn').click();
  await page.waitForTimeout(120); // presses land mid-morph on purpose
}
check(((await page.locator('#undoBtn').textContent()) ?? '').includes('(5)'), 'undo depth should cap at 5');
await page.waitForTimeout(MORPH_WAIT);

// --- details panel ---
ctxLabel = 'details';
await page.locator('#detailsBtn').click();
await page.waitForTimeout(200);
check(await page.locator('#details').isVisible(), 'details panel not visible');
check((await page.locator('#details h3').count()) >= 5, 'details sections missing');
await page.locator('#detailsBtn').click();

// --- every built-in preset loads (sound running) ---
const values = await page.$$eval('#presetSel option', (els) => els.map((o) => o.value).filter((v) => v.startsWith('b:')));
ctxLabel = 'presets';
check(values.length >= 8, `expected ≥8 presets, got ${values.length}`);
for (const v of values) {
  ctxLabel = `preset:${v}`;
  await page.selectOption('#presetSel', v);
  await page.waitForTimeout(700);
  check((await statusText()).startsWith('loaded'), `status after loading ${v}`);
  check(await page.locator('#undoBtn').isDisabled(), 'loading a preset should clear history');
}

// --- ?preset=N query param ---
ctxLabel = 'preset-query';
const qp = await context.newPage();
captureErrors(qp, errors, () => 'preset-query');
await openApp(qp, withRes(`${BASE}/?preset=2`, RES));
const q2 = await page.$eval('#presetSel option[value="b:2"]', (o) => o.textContent ?? '');
check((await statusText(qp)).includes(q2.replace(/^2: /, '')), `?preset=2 did not load "${q2}"`);
await qp.close();

// --- save a point, reload, load it back ---
ctxLabel = 'save';
page.once('dialog', (d) => d.accept('Smoke point'));
await page.locator('#saveBtn').click();
await page.waitForTimeout(300);
const userOpts = await page.$$eval('#presetSel option', (els) => els.map((o) => o.value).filter((v) => v.startsWith('u:')));
check(userOpts.length === 1, 'saved point missing from the list');
await page.reload();
await page.waitForSelector('body[data-ready="1"]', { timeout: 30000 });
check(await page.locator('#help').isHidden(), 'help dialog should not reopen after the first visit');
check(((await page.locator('#audioBtn').textContent()) ?? '').includes('▶'), 'audio must not autostart after reload');
await page.locator('#audioBtn').click();
await page.waitForTimeout(1500);
check(((await page.locator('#audioBtn').textContent()) ?? '').includes('⏹'), 'audio did not restart after reload');
const afterReload = await page.$$eval('#presetSel option', (els) => els.map((o) => o.textContent ?? '').filter((t) => t.includes('Smoke point')));
check(afterReload.length === 1, 'saved point did not survive reload');
await page.selectOption('#presetSel', 'u:0');
await page.waitForTimeout(500);
check((await statusText()).includes('Smoke point'), 'loading the saved point');

// --- share link round trip ---
ctxLabel = 'share';
await page.locator('#likeBtn').click();
await page.waitForTimeout(MORPH_WAIT);
await page.locator('#shareBtn').click();
await page.waitForTimeout(300);
const clip = await page.evaluate(() => navigator.clipboard.readText()).catch(() => '');
check(clip.includes('#s='), 'share link not copied');
if (clip.includes('#s=')) {
  const page2 = await context.newPage();
  captureErrors(page2, errors, () => 'share:page2');
  await openApp(page2, withRes(clip, RES));
  check((await statusText(page2)).startsWith('opened link'), 'share link did not open');
  await page2.locator('#detailsBtn').click();
  await page.locator('#detailsBtn').click();
  await page.waitForTimeout(200);
  const a = await page.locator('#details').evaluate((n) => n.textContent);
  const b = await page2.locator('#details').evaluate((n) => n.textContent);
  check(a === b, 'shared point differs from the original');
  await page.locator('#detailsBtn').click();
  await page2.close();
}

// --- stop audio ---
ctxLabel = 'stop';
await page.locator('#audioBtn').click();
await page.waitForTimeout(600);
check(((await page.locator('#audioBtn').textContent()) ?? '').includes('▶'), 'audio did not stop');
await page.locator('#likeBtn').click(); // feedback still works without sound
await page.waitForTimeout(300);

if (flags.has('screenshot')) {
  const out = flags.get('screenshot');
  mkdirSync(dirname(out), { recursive: true });
  await page.screenshot({ path: out });
  console.log('screenshot:', out);
}

await browser.close();
stop();

if (errors.length) {
  console.error('SMOKE FAILED');
  for (const e of errors) console.error(' -', e);
  process.exit(1);
}
console.log(`smoke ok (${values.length} presets)`);
