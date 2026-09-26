#!/usr/bin/env node
// Reusable debug screenshot of the app. Extend with flags instead of
// writing one-off Playwright scripts.
//
//   node scripts/snap.mjs --out shots/x.png [--preset N] [--hash token] [--wait ms]
//                         [--sound] [--like N] [--dislike N] [--details] [--help]
//                         [--width px] [--height px] [--res N] [--preview]
//                         [--reseed] [--stroke x0,y0,x1,y1]
//                                                  # restart the pattern, then drag across
//                                                  # the canvas (fractions of it)
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { parseFlags, startServer, launchBrowser, captureErrors, openApp, withRes } from './lib.mjs';

const { flags } = parseFlags(process.argv.slice(2), ['out', 'preset', 'hash', 'wait', 'like', 'dislike', 'width', 'height', 'res', 'stroke']);
if (!flags.has('out')) {
  console.error('usage: node scripts/snap.mjs --out <path> [--preset N] [--hash token] [--wait ms] '
    + '[--sound] [--like N] [--dislike N] [--details] [--help] [--width px] [--height px] [--preview]');
  process.exit(1);
}
const { BASE, stop } = await startServer(flags.has('preview'));
const errors = [];
const browser = await launchBrowser();
const page = await browser.newPage({
  viewport: { width: Number(flags.get('width')) || 1280, height: Number(flags.get('height')) || 820 },
});
captureErrors(page, errors);

const url = flags.has('hash') ? `${BASE}/#s=${flags.get('hash')}`
  : flags.has('preset') ? `${BASE}/?preset=${flags.get('preset')}` : BASE;
await openApp(page, withRes(url, Number(flags.get('res') ?? 0)), { keepHelp: flags.has('help') });
if (flags.has('sound')) { await page.locator('#audioBtn').click(); await page.waitForTimeout(800); }
for (let i = 0; i < Number(flags.get('like') ?? 0); i++) { await page.locator('#likeBtn').click(); await page.waitForTimeout(2400); }
for (let i = 0; i < Number(flags.get('dislike') ?? 0); i++) { await page.locator('#dislikeBtn').click(); await page.waitForTimeout(2400); }
if (flags.has('reseed')) { await page.locator('#reseedBtn').click(); await page.waitForTimeout(400); }
if (flags.has('stroke')) {
  const [x0, y0, x1, y1] = flags.get('stroke').split(',').map(Number);
  const box = await page.locator('#view').boundingBox();
  const at = (fx, fy) => [box.x + box.width * fx, box.y + box.height * fy];
  await page.mouse.move(...at(x0, y0));
  await page.mouse.down();
  await page.waitForTimeout(300);
  await page.mouse.move(...at(x1, y1), { steps: 24 });
  await page.waitForTimeout(600);
  await page.mouse.up();
}
if (flags.has('details')) await page.locator('#detailsBtn').click();
await page.waitForTimeout(Number(flags.get('wait')) || 3000);

const out = flags.get('out');
mkdirSync(dirname(out), { recursive: true });
await page.screenshot({ path: out });
console.log(out);
console.log('#status:', await page.locator('#status').textContent());
console.log('errors:', errors.length ? errors : 'none');
await browser.close();
stop();
process.exit(errors.length ? 2 : 0);
