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
// Wake lock is refused in headless unless the permission is granted; when it
// is, the app must actually take one (phones dim the screen otherwise).
const wakeGrantable = await context.grantPermissions(['screen-wake-lock']).then(() => true).catch(() => false);
const page = await context.newPage();
captureErrors(page, errors, () => ctxLabel);

function check(cond, msg) {
  if (!cond) errors.push(`[${ctxLabel}] ${msg}`);
}

// Native dialogs are never used: mobile browsers may suppress them, and a
// suppressed prompt() returns null, so Save would do nothing at all.
let nativeDialog = '';
page.on('dialog', (d) => { nativeDialog = `${d.type()}: ${d.message()}`; void d.dismiss(); });

// The app's own prompt/confirm (src/ui/askDialog.ts).
async function askDialog(p = page) {
  await p.waitForSelector('#askDialog', { timeout: 5000 });
  // must fit the screen, buttons and all — a phone showed neither for #help
  const box = await p.locator('#askDialog .ask-box').boundingBox();
  const vp = p.viewportSize();
  check(box && box.y >= 0 && box.y + box.height <= vp.height + 1, `dialog does not fit: ${JSON.stringify(box)} in ${vp.height}px`);
  return {
    title: (await p.locator('#askDialog .ask-title').textContent()) ?? '',
    value: await p.$eval('#askInput', (i) => i.value).catch(() => null),
  };
}
async function askAccept(text, p = page) {
  const seen = await askDialog(p);
  if (text !== undefined) await p.fill('#askInput', text);
  await p.locator('#askOk').click();
  await p.waitForSelector('#askDialog', { state: 'detached', timeout: 5000 });
  return seen;
}
async function askCancel(p = page) {
  const seen = await askDialog(p);
  await p.locator('#askCancel').click();
  await p.waitForSelector('#askDialog', { state: 'detached', timeout: 5000 });
  return seen;
}

// The points panel (ui/pointList.ts) replaced the native <select>: a phone
// renders <select> options as a system sheet, with no room for a 🗑 per row.
async function openPoints(p = page) {
  await p.locator('#pointsBtn').click();
  await p.waitForSelector('#points:not([hidden])', { timeout: 5000 });
}
async function closePoints(p = page) {
  await p.locator('#pointsCloseX').click();
  await p.waitForSelector('#points[hidden]', { state: 'attached', timeout: 5000 });
}
/** [{ ref, name, mine }] as the panel shows them. */
async function listPoints(p = page) {
  await openPoints(p);
  const rows = await p.$$eval('#pointsList .point-row', (els) => els.map((row) => ({
    ref: row.querySelector('.point-pick')?.dataset.point ?? '',
    name: row.querySelector('.point-pick')?.textContent ?? '',
    mine: !!row.querySelector('.point-del'),
  })));
  await closePoints(p);
  return rows;
}
const myPoints = async (p = page) => (await listPoints(p)).filter((r) => r.mine);
async function pickPoint(ref, p = page) {
  await openPoints(p);
  await p.locator(`[data-point="${ref}"]`).click();
  await p.waitForSelector('#points[hidden]', { state: 'attached', timeout: 5000 });
}
async function deletePoint(ref, accept = true) {
  await openPoints();
  await page.locator(`[data-del="${ref}"]`).click();
  const seen = accept ? await askAccept() : await askCancel();
  await page.waitForTimeout(300);
  if (!(await page.locator('#points').isHidden())) await closePoints();
  return seen;
}

/** How many points the (local) database holds. */
const rows = () => worker.db.prepare('SELECT COUNT(*) AS n FROM points').first().then((r) => r.n);

const statusText = async (p = page) => (await p.locator('#status').textContent()) ?? '';
const hashOf = (p = page) => p.evaluate(() => location.hash);
const MORPH_WAIT = 2400; // > MORPH_SECONDS in main.ts

await openApp(page, app(BASE), { keepHelp: true });
check(await page.locator('#help').isVisible(), 'help dialog should open on first visit');
// the whole dialog, and its close button, must fit on screen (small phones)
{
  const vp = page.viewportSize();
  const box = await page.locator('#helpBox').boundingBox();
  const btn = await page.locator('#helpCloseBtn').boundingBox();
  check(box && box.y >= 0 && box.y + box.height <= vp.height + 1, `help dialog does not fit: ${JSON.stringify(box)} in ${vp.height}px`);
  check(btn && btn.y + btn.height <= vp.height + 1, `help "Got it" button is off screen: ${JSON.stringify(btn)}`);
  const scrolls = await page.locator('#helpContent').evaluate((n) => n.scrollHeight > n.clientHeight + 1 || getComputedStyle(n).overflowY === 'auto');
  check(scrolls, 'help text should live in a scrollable area');
}
await page.keyboard.press('Escape');
check(await page.locator('#help').isHidden(), 'Escape should close the help dialog');
await page.locator('#helpBtn').click();
await page.locator('#helpCloseBtn').click();
check((await statusText()).includes('Fractal garden'), 'default preset is not Fractal garden');
if (wakeGrantable) {
  ctxLabel = 'wakelock';
  await page.waitForFunction(() => document.body.dataset.awake === '1', null, { timeout: 5000 }).catch(() => {});
  check(await page.evaluate(() => document.body.dataset.awake === '1'), 'the screen wake lock was not taken after a gesture');
  ctxLabel = 'boot';
}
check((await hashOf()) === '', 'the address bar must not carry the point (#s=)');
check(!!(await lastPoint()), 'the current point is not kept in localStorage');
check(await page.locator('#webglError').isHidden(), 'WebGL error shown');

// --- sound ---
ctxLabel = 'audio';
await page.locator('#audioBtn').click();
await page.waitForTimeout(1500);
check(((await page.locator('#audioBtn').textContent()) ?? '').includes('⏹'), 'audio did not start');
// iOS Ring/Silent switch: a silent <audio> must be playing alongside Web
// Audio, started synchronously in the click (src/audio/iosUnlock.ts). Not
// testable on real iOS from here, so this guards against it being dropped.
{
  const unlocked = await page.waitForFunction(() => document.body.dataset.iosUnlock === '1', null, { timeout: 10000 })
    .then(() => true).catch(() => false);
  check(unlocked, `the iOS silent-audio unlock did not start (data-ios-unlock=${await page.evaluate(() => document.body.dataset.iosUnlock)})`);
}

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
// it must be closable from the panel itself, not only from the toolbar
check(await page.locator('#detailsCloseBtn').isVisible(), 'details panel needs its own close button');
await page.locator('#detailsCloseBtn').click();
await page.waitForTimeout(150);
check(await page.locator('#details').isHidden(), 'the close button should close the details panel');

// --- every built-in preset loads (sound running) ---
const values = (await listPoints()).filter((r) => !r.mine).map((r) => r.ref);
ctxLabel = 'presets';
check(values.length >= 8, `expected ≥8 presets, got ${values.length}`);
for (const v of values) {
  ctxLabel = `preset:${v}`;
  await pickPoint(v);
  await page.waitForTimeout(700);
  check((await statusText()).startsWith('loaded'), `status after loading ${v}`);
  check(await page.locator('#undoBtn').isDisabled(), 'loading a preset should clear history');
}

// --- ?preset=N query param ---
ctxLabel = 'preset-query';
const qp = await context.newPage();
captureErrors(qp, errors, () => 'preset-query');
await openApp(qp, app(`${BASE}/?preset=2`));
const q2 = (await listPoints()).find((r) => r.ref === 'b:2')?.name ?? '';
check((await statusText(qp)).includes(q2.replace(/^2: /, '')), `?preset=2 did not load "${q2}"`);
check(((await qp.locator('#pointsBtn').textContent()) ?? '').includes(q2), `?preset=2 should show the preset as current: "${await qp.locator('#pointsBtn').textContent()}"`);
await qp.close();

// --- save a point, reload, load it back ---
ctxLabel = 'save';
// the suggested name must not be a built-in preset's name (a saved copy that
// looks exactly like the built-in reads as "nothing was saved")
await pickPoint('b:3');
await page.waitForTimeout(600);
const builtinName = ((await listPoints()).find((r) => r.ref === 'b:3')?.name ?? '').replace(/^\d+: /, '');
const pointsBefore = await worker.db.prepare('SELECT COUNT(*) AS n FROM points').first();
await page.locator('#saveBtn').click();
const suggestedName = (await askAccept('Smoke point')).value ?? '';
await page.waitForFunction(() => (document.getElementById('status')?.textContent ?? '').includes('saved as'), null, { timeout: 15000 }).catch(() => {});
const saved = await listPoints();
const savedMine = saved.filter((r) => r.mine);
check(savedMine.length === 1, `saved point missing from the list: ${JSON.stringify(saved.slice(0, 4))}`);
check(suggestedName !== builtinName, `suggested name duplicates the built-in "${builtinName}"`);
// saved points come first: a fresh save must be visible without scrolling
check(saved[0]?.mine === true, `saved points should be listed above the built-ins: ${JSON.stringify(saved.slice(0, 3))}`);
check(savedMine[0].name.includes('Smoke point'), `the saved point should carry its name: "${savedMine[0].name}"`);
check(((await page.locator('#pointsBtn').textContent()) ?? '').includes('Smoke point'), 'the toolbar should show the saved point as current');
check((await statusText()).includes('Smoke point'), `save should confirm in the status line: "${await statusText()}"`);
// the point itself goes to the points database; only name+id stay local
check((await worker.db.prepare('SELECT COUNT(*) AS n FROM points').first()).n === pointsBefore.n + 1, 'saving should store the point in the database');
const localList = await page.evaluate(() => localStorage.getItem('synesthesia_library_v1') ?? '');
check(localList.includes('Smoke point') && localList.length < 200, `the local list should be a short name+id list: ${localList.length} chars`);
check(!(await page.evaluate(() => Object.keys(localStorage))).includes('synesthesia_user_presets_v1'), 'nothing should write whole points locally any more');
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
const afterReload = (await myPoints()).filter((r) => r.name.includes('Smoke point'));
check(afterReload.length === 1, 'saved point did not survive reload');
await pickPoint('u:0');
await page.waitForFunction(() => (document.getElementById('status')?.textContent ?? '').startsWith('loaded'), null, { timeout: 15000 }).catch(() => {});
check((await statusText()).includes('Smoke point'), `loading the saved point: "${await statusText()}"`);

// --- delete a saved point (built-ins can't be deleted) ---
ctxLabel = 'delete';
// 🗑 sits on the row it deletes — that is the whole reason the native
// <select> had to go
check((await myPoints()).every((r) => r.mine), 'saved points should offer a delete button');
check(await page.locator('[data-del="b:0"]').count() === 0, 'built-in presets must not be deletable');
const confirmText = (await deletePoint('u:0')).title;
check(confirmText.includes('Smoke point'), `delete should confirm by name: "${confirmText}"`);
check((await statusText()).includes('deleted'), `delete should report in the status line: "${await statusText()}"`);
check((await myPoints()).length === 0, 'the deleted point is still in the list');
check(!(await page.evaluate(() => localStorage.getItem('synesthesia_library_v1') ?? '')).includes('Smoke point'), 'the deleted point is still in localStorage');
// a cancelled delete keeps the point
await page.locator('#saveBtn').click();
await askAccept('Kept point');
await page.waitForFunction(() => (document.getElementById('status')?.textContent ?? '').includes('saved as'), null, { timeout: 15000 }).catch(() => {});
await deletePoint('u:0', false);
check((await myPoints()).length === 1, 'cancelling the confirm must keep the point');

// --- a save that the browser refuses must say so, not fail silently ---
// The localStorage quota is shared by every app on the origin, so a user
// with other saved things can hit it here. Refusing the app's own key
// reproduces that exactly, without depending on the browser's quota size.
ctxLabel = 'storage full';
await page.evaluate((key) => {
  const real = Storage.prototype.setItem;
  window.__allowStorage = () => { Storage.prototype.setItem = real; };
  Storage.prototype.setItem = function setItem(k, v) {
    if (k === key) throw new DOMException('quota', 'QuotaExceededError');
    return real.call(this, k, v);
  };
}, 'synesthesia_library_v1');
await page.locator('#saveBtn').click();
await askAccept('No room point');
await page.waitForTimeout(400);
check((await statusText()).includes("couldn't add"), `a refused save must be reported: "${await statusText()}"`);
check((await statusText()).includes('full'), `a refused save should say the storage is full: "${await statusText()}"`);
// the point reached the database, so the user is handed its link instead
check(/presetId=[0-9A-Za-z]{10}/.test(await statusText()), `a refused save should hand over the link: "${await statusText()}"`);
check(!(await myPoints()).some((r) => r.name.includes('No room point')), 'a point that was not listed must not appear as saved');
await page.evaluate(() => window.__allowStorage());
await page.locator('#saveBtn').click();
await askAccept('Room again point');
await page.waitForFunction(() => (document.getElementById('status')?.textContent ?? '').includes('saved as'), null, { timeout: 15000 }).catch(() => {});
check((await statusText()).includes('saved as'), `saving must work again once there is room: "${await statusText()}"`);
check((await myPoints()).some((r) => r.name.includes('Room again point')), 'the point saved after freeing space is missing');

// --- points saved by the old build move to the library on boot ---
// (that migration is also what frees a full quota: ~4.4 KB per old point)
ctxLabel = 'migrate';
{
  const before = await rows();
  await page.evaluate(() => {
    const state = JSON.parse(localStorage.getItem('synesthesia_last_point_v1') ?? 'null');
    state.presetName = 'Old build point';
    localStorage.setItem('synesthesia_user_presets_v1', JSON.stringify([{ name: 'Old build point', state }]));
  });
  await page.reload();
  await page.waitForSelector('body[data-ready="1"]', { timeout: 30000 });
  await page.waitForSelector('body[data-migrated]', { timeout: 20000 });
  check((await page.evaluate(() => document.body.dataset.migrated)) === '1/stored', `migration should store one point: ${await page.evaluate(() => document.body.dataset.migrated)}`);
  const mine = await myPoints();
  const moved = mine.find((r) => r.name.includes('Old build point'));
  check(!!moved, `the old point should be in My points: ${JSON.stringify(mine)}`);
  check(await rows() === before + 1, 'the migrated point should have been uploaded');
  check(!(await page.evaluate(() => Object.keys(localStorage))).includes('synesthesia_user_presets_v1'), 'the old key should be dropped once its points are uploaded');
  await page.locator('#audioBtn').click(); // the reload stopped the sound
  await page.waitForTimeout(1200);
  check(((await page.locator('#audioBtn').textContent()) ?? '').includes('⏹'), 'audio did not restart after the migration reload');
  if (moved) {
    await pickPoint(moved.ref);
    await page.waitForFunction(() => (document.getElementById('status')?.textContent ?? '').startsWith('loaded'), null, { timeout: 15000 }).catch(() => {});
    check((await statusText()).includes('Old build point'), `a migrated point should open from the database: "${await statusText()}"`);
  }
}

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
if (idMatch) {
  check((await worker.db.prepare('SELECT COUNT(*) AS n FROM points WHERE id = ?').bind(idMatch[1]).first()).n === 1, 'point not stored');
}
// sharing the same point again is idempotent (same id, no new row)
const beforeReshare = await rows();
await page.locator('#shareBtn').click();
await page.waitForTimeout(1500);
const clip2 = await page.evaluate(() => navigator.clipboard.readText()).catch(() => '');
check(clip2 === clip, 're-sharing the same point should give the same link');
check(await rows() === beforeReshare, 're-share stored a duplicate');
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
  // saving needs the same server: it must say so, not invent a saved point
  await off.locator('#saveBtn').click();
  await askAccept('Offline point', off);
  await off.waitForFunction(() => (document.getElementById('status')?.textContent ?? '').includes("couldn't save"), null, { timeout: 20000 }).catch(() => {});
  check((await statusText(off)).includes('unreachable'), `offline save status: "${await statusText(off)}"`);
  // (same origin as the main page, so its points are here too — only the
  // one that failed to save must be missing)
  check(!(await myPoints(off)).some((r) => r.name.includes('Offline point')), 'an unsaved point must not be listed');
  errors.push(...offErrors.filter((e) => !/Failed to load resource|ERR_CONNECTION_REFUSED/.test(e)));
  await off.close();
}

// --- a touch on the canvas seeds the picture, a drag paints a stroke ---
ctxLabel = 'touch';
{
  const box = await page.locator('#view').boundingBox();
  const seeds = () => page.evaluate(() => Number(document.body.dataset.touchSeeds ?? 0));
  check((await seeds()) === 0, 'nothing should have been painted before the first touch');
  await page.mouse.move(box.x + box.width * 0.3, box.y + box.height * 0.4);
  await page.mouse.down();
  await page.waitForTimeout(400);
  const afterPress = await seeds();
  check(afterPress > 0, 'a press on the canvas did not seed the picture');
  // A drag must lay a trail, not a single dot at the far end.
  await page.mouse.move(box.x + box.width * 0.7, box.y + box.height * 0.6, { steps: 8 });
  await page.waitForTimeout(600);
  await page.mouse.up();
  const afterDrag = await seeds();
  check(afterDrag > afterPress + 1, `a drag laid ${afterDrag - afterPress} stamp(s), expected a trail`);
  // Releasing stops it: no stamps once the pointer is up.
  await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.5, { steps: 4 });
  await page.waitForTimeout(400);
  check((await seeds()) === afterDrag, 'the canvas kept painting after the pointer was released');
  // The picture must still be a picture (the sim survives the injections).
  check(await page.locator('#webglError').isHidden(), 'WebGL error after painting');
}

// --- the boot probe picks a rung, and the app renders at the one it picked ---
// (every other page here passes ?res=, which switches the probe off; this is
// the only place the auto-tuning path runs at all)
ctxLabel = 'tune';
{
  const tuned = await context.newPage();
  captureErrors(tuned, errors, () => 'tune');
  await openApp(tuned, withParam(BASE, 'api', worker.url));
  const settled = await tuned.waitForFunction(() => document.body.dataset.tuned !== undefined, null, { timeout: 60000 })
    .then(() => true).catch(() => false);
  check(settled, 'the boot probe never settled on a rung');
  const d = await tuned.evaluate(() => ({ ...document.body.dataset }));
  check(/^\d+x\d+$/.test(d.grid ?? ''), `grid not reported: ${d.grid}`);
  check(/^\d+x\d+$/.test(d.canvas ?? ''), `canvas not reported: ${d.canvas}`);
  // Software rasterizer: it must NOT have climbed to the top rung, or the
  // probe is not measuring anything.
  check(Number(d.tuned) < 5, `probe kept the top rung under SwiftShader (rung ${d.tuned}, ${d.canvas}, grid ${d.grid})`);
  // The canvas it chose must be no larger than that rung allows.
  const [cw, ch] = (d.canvas ?? '0x0').split('x').map(Number);
  const maxSide = [640, 840, 1080, 1280, 1600, Infinity][Number(d.tuned)];
  check(Math.max(cw, ch) <= maxSide, `canvas ${d.canvas} exceeds rung ${d.tuned} (max side ${maxSide})`);
  check(await tuned.locator('#webglError').isHidden(), 'WebGL error on the auto-tuned page');
  await tuned.close();
}

// --- stop audio ---
ctxLabel = 'stop';
await page.locator('#audioBtn').click();
await page.waitForTimeout(600);
check(((await page.locator('#audioBtn').textContent()) ?? '').includes('▶'), 'audio did not stop');
check(await page.evaluate(() => document.body.dataset.iosUnlock === '0'), 'the silent unlock element kept playing after Stop');
await page.locator('#likeBtn').click(); // feedback still works without sound
await page.waitForTimeout(300);

check(nativeDialog === '', `the app must not use native dialogs (they can be suppressed on mobile): ${nativeDialog}`);

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
