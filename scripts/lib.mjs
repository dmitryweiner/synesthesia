// Shared helpers for the Playwright scripts: dev/preview server lifecycle,
// flag parsing, browser launch, console-error capture.
import { spawn } from 'node:child_process';
import { chromium } from 'playwright';

export function parseFlags(argv, valueFlags, repeatable = []) {
  const flags = new Map();
  const lists = new Map(repeatable.map((r) => [r, []]));
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const name = a.slice(2);
    if (lists.has(name)) { lists.get(name).push(argv[++i]); continue; }
    flags.set(name, valueFlags.includes(name) ? argv[++i] : 'true');
  }
  return { flags, lists };
}

/** Reuses a running dev (:5173) / preview (:4173) server or spawns one. */
export async function ensureServer(preview) {
  const PORT = preview ? 4173 : 5173;
  const BASE = `http://localhost:${PORT}`;
  const up = async () => { try { return (await fetch(BASE)).ok; } catch { return false; } };
  let proc = null;
  if (!(await up())) {
    const cmd = preview
      ? ['vite', 'preview', '--port', String(PORT), '--strictPort']
      : ['vite', '--port', String(PORT), '--strictPort'];
    proc = spawn('npx', cmd, { stdio: 'ignore' });
    for (let i = 0; i < 30 && !(await up()); i++) await new Promise((r) => setTimeout(r, 1000));
    if (!(await up())) { console.error(`server did not start on :${PORT}`); process.exit(1); }
  }
  return { BASE, stop: () => proc?.kill() };
}

// Autoplay so an AudioContext starts without a real gesture; SwiftShader
// for a software WebGL2 path in headless mode (fps there means nothing).
// CHROMIUM_PATH overrides the bundled browser (e.g. a system Chromium).
export function launchBrowser() {
  return chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || undefined,
    args: [
      '--autoplay-policy=no-user-gesture-required',
      '--use-gl=angle',
      '--use-angle=swiftshader',
      '--enable-unsafe-swiftshader',
    ],
  });
}

/**
 * Navigates and waits until boot() finished (body[data-ready]) — shader
 * compilation under SwiftShader on a slow CPU can take seconds, so fixed
 * sleeps race with the help dialog. Closes the help dialog unless keepHelp.
 */
export async function openApp(page, url, { keepHelp = false } = {}) {
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForSelector('body[data-ready="1"]', { timeout: 60000 });
  if (!keepHelp && await page.locator('#help').isVisible()) {
    await page.locator('#helpCloseBtn').click();
  }
}

/** Adds `?res=N` (simulation grid) to an app URL, keeping any query/hash. */
export function withRes(url, res) {
  if (!res) return url;
  const u = new URL(url);
  u.searchParams.set('res', String(res));
  return u.toString();
}

export function captureErrors(page, errors, label = () => 'app') {
  page.on('pageerror', (e) => errors.push(`[${label()}] ${String(e)}`));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`[${label()}] ${m.text()}`); });
}
