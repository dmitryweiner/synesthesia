#!/usr/bin/env node
// Browser smoke test — the only way to exercise WebGL2 + Web Audio (vitest
// can't load them). Boots the app, starts sound, presses every feedback
// button, undoes, loads every preset, saves a point and reloads it (the last
// point comes back), shares a short ?presetId= link through a LOCAL points
// Worker (Miniflare, never production) and opens it in a second tab, opens
// an old #s= link, and checks the long-link fallback when the Worker is
// unreachable. Fails on any console/page error or broken
// invariant; checks invariants only, never pixels.
//
//   node scripts/smoke.mjs [--preview] [--mobile] [--res 128] [--screenshot shots/smoke.png]
//
// --res sets the simulation grid (default 128): headless Chromium renders
// WebGL through SwiftShader, and a 1024² grid starves the CPU enough for a
// second tab's navigation to time out.
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { parseFlags, ensureServer, launchBrowser, captureErrors, openApp, withRes, withParam, startPointsWorker } from './lib.mjs';

const { flags } = parseFlags(process.argv.slice(2), ['screenshot', 'res']);
const RES = Number(flags.get('res') ?? 128);
const { BASE, stop } = await ensureServer(flags.has('preview'));
const worker = await startPointsWorker();
// every app URL: small grid + the local points Worker
const app = (url) => withParam(withRes(url, RES), 'api', worker.url);
const lastPoint = (p = page) => p.evaluate(() => localStorage.getItem('synesthesia_last_point_v1'));
// Same point, up to float noise (a restored point goes through the genome
// codec, e.g. 55 → 55.00000000000001).
function samePoint(a, b) {
  const norm = (json) => JSON.stringify(JSON.parse(json), (_k, v) => (typeof v === 'number' ? Number(v.toPrecision(9)) : v));
  try { return norm(a) === norm(b); } catch { return false; }
}

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

await openApp(page, app(BASE), { keepHelp: true });
check(await page.locator('#help').isVisible(), 'help dialog should open on first visit');
await page.locator('#helpCloseBtn').click();
check((await statusText()).includes('Fractal garden'), 'default preset is not Fractal garden');
check((await hashOf()) === '', 'the address bar must not carry the point (#s=)');
check(!!(await lastPoint()), 'the current point is not kept in localStorage');
check(await page.locator('#webglError').isHidden(), 'WebGL error shown');

// --- sound ---
ctxLabel = 'audio';
await page.locator('#audioBtn').click();
await page.waitForTimeout(1500);
check(((await page.locator('#audioBtn').textContent()) ?? '').includes('⏹'), 'audio did not start');

// --- scout: with sound on, 3 👍 + 3 👎 candidates get rendered offline and
// scored; the next 👍 must commit the best of them ---
ctxLabel = 'scout';
const scouted = await page.waitForSelector('body[data-scout="3/3"]', { timeout: 180000 }).then(() => true).catch(() => false);
check(scouted, `scout did not finish (data-scout=${await page.evaluate(() => document.body.dataset.scout)})`);
await page.locator('#detailsBtn').click();
await page.waitForTimeout(200);
check(((await page.locator('#details').textContent()) ?? '').includes('Fractality'), 'details lack the fractality section');
await page.locator('#detailsBtn').click();

// --- feedback loop ---
ctxLabel = 'like';
const last0 = await lastPoint();
await page.locator('#likeBtn').click();
await page.waitForTimeout(300);
check((await statusText()).includes('continuing'), 'like status missing');
if (scouted) check((await statusText()).includes('scouted: best of 3'), `like did not use the scout: "${await statusText()}"`);
await page.waitForTimeout(MORPH_WAIT);
check((await lastPoint()) !== last0, 'last point not updated after like');
check((await hashOf()) === '', 'the address bar must stay clean after a step');
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
await openApp(qp, app(`${BASE}/?preset=2`));
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
const beforeReload = await lastPoint();
await page.reload();
await page.waitForSelector('body[data-ready="1"]', { timeout: 30000 });
check(await page.locator('#help').isHidden(), 'help dialog should not reopen after the first visit');
check((await statusText()).startsWith('restored'), `reload should restore the last point: "${await statusText()}"`);
check(samePoint(await lastPoint(), beforeReload), 'restored point differs from the one before the reload');
check(((await page.locator('#audioBtn').textContent()) ?? '').includes('▶'), 'audio must not autostart after reload');
await page.locator('#audioBtn').click();
await page.waitForTimeout(1500);
check(((await page.locator('#audioBtn').textContent()) ?? '').includes('⏹'), 'audio did not restart after reload');
const afterReload = await page.$$eval('#presetSel option', (els) => els.map((o) => o.textContent ?? '').filter((t) => t.includes('Smoke point')));
check(afterReload.length === 1, 'saved point did not survive reload');
await page.selectOption('#presetSel', 'u:0');
await page.waitForTimeout(500);
check((await statusText()).includes('Smoke point'), 'loading the saved point');

// --- share: short link through the (local) points Worker ---
ctxLabel = 'share';
await page.locator('#likeBtn').click();
await page.waitForTimeout(MORPH_WAIT);
await page.locator('#shareBtn').click();
await page.waitForFunction(() => (document.getElementById('status')?.textContent ?? '').includes('copied'), null, { timeout: 15000 }).catch(() => {});
check((await statusText()).startsWith('short link copied'), `share status: "${await statusText()}"`);
const clip = await page.evaluate(() => navigator.clipboard.readText()).catch(() => '');
const idMatch = /[?&]presetId=([0-9A-Za-z]{10})(?:&|$)/.exec(clip);
check(!!idMatch, `short link not copied: "${clip}"`);
check(!clip.includes('#s='), 'the short link must not carry the long token');
check(clip.length < 160, `short link is ${clip.length} chars`);
check((await page.evaluate(() => location.search)).includes('presetId='), 'the address bar should show the short link after Share');
check((await worker.db.prepare('SELECT COUNT(*) AS n FROM points').first()).n === 1, 'point not stored');
// sharing the same point again is idempotent (same id, no new row)
await page.locator('#shareBtn').click();
await page.waitForTimeout(1500);
const clip2 = await page.evaluate(() => navigator.clipboard.readText()).catch(() => '');
check(clip2 === clip, 're-sharing the same point should give the same link');
check((await worker.db.prepare('SELECT COUNT(*) AS n FROM points').first()).n === 1, 're-share stored a duplicate');
if (idMatch) {
  const page2 = await context.newPage();
  captureErrors(page2, errors, () => 'share:page2');
  await openApp(page2, withRes(clip, RES)); // clip already carries ?api=
  await page2.waitForSelector('body[data-launched="1"]', { timeout: 30000 });
  check((await statusText(page2)).startsWith('opened link'), `short link did not open: "${await statusText(page2)}"`);
  check((await page2.evaluate(() => location.search)).includes(`presetId=${idMatch[1]}`), 'opened link should keep ?presetId= until the next step');
  await page2.locator('#detailsBtn').click();
  await page.locator('#detailsBtn').click();
  await page.waitForTimeout(200);
  // Compare everything but the Fractality section (only present where the
  // scout ran, i.e. with sound on).
  const pointText = (n) => [...n.querySelectorAll('h3')]
    .filter((h) => !(h.textContent ?? '').startsWith('Fractality'))
    .map((h) => `${h.textContent}:${h.nextElementSibling?.textContent ?? ''}`).join('|');
  const a = await page.locator('#details').evaluate(pointText);
  const b = await page2.locator('#details').evaluate(pointText);
  check(a === b, 'shared point differs from the original');
  await page.locator('#detailsBtn').click();
  // a step drops ?presetId= from the address bar
  await page2.locator('#likeBtn').click();
  await page2.waitForTimeout(300);
  check(!(await page2.evaluate(() => location.search)).includes('presetId='), '?presetId= should go away after a step');
  await page2.close();
}

// --- old long #s= links still open, and the address bar is cleaned ---
ctxLabel = 'old-link';
{
  const token = Buffer.from(JSON.stringify({ presetName: 'Old long link', audio: { formulas: { fm: { enabled: true } } } })).toString('base64url');
  const old = await context.newPage();
  captureErrors(old, errors, () => 'old-link');
  await openApp(old, `${app(BASE)}#s=${token}`);
  check((await statusText(old)).includes('Old long link'), `old #s= link did not open: "${await statusText(old)}"`);
  check((await old.evaluate(() => location.hash)) === '', 'old #s= link should be cleaned from the address bar');
  await old.close();
}

// --- Worker unreachable → Share falls back to the long link ---
ctxLabel = 'share-offline';
{
  const off = await context.newPage();
  // The failed fetch logs "Failed to load resource" — expected here; any
  // other console error still fails the smoke.
  const offErrors = [];
  captureErrors(off, offErrors, () => 'share-offline');
  await openApp(off, withParam(withRes(BASE, RES), 'api', 'http://localhost:8799'));
  await off.locator('#shareBtn').click();
  await off.waitForFunction(() => (document.getElementById('status')?.textContent ?? '').includes('copied'), null, { timeout: 20000 }).catch(() => {});
  check((await statusText(off)).includes('long link'), `offline share status: "${await statusText(off)}"`);
  const longClip = await off.evaluate(() => navigator.clipboard.readText()).catch(() => '');
  check(longClip.includes('#s='), 'offline share should copy the long #s= link');
  errors.push(...offErrors.filter((e) => !/Failed to load resource|ERR_CONNECTION_REFUSED/.test(e)));
  await off.close();
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
await worker.stop();
stop();

if (errors.length) {
  console.error('SMOKE FAILED');
  for (const e of errors) console.error(' -', e);
  process.exit(1);
}
console.log(`smoke ok (${values.length} presets)`);
