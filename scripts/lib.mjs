// Shared helpers for the Playwright scripts: dev/preview server lifecycle,
// flag parsing, browser launch, console-error capture.
import { spawn, execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from 'playwright';

const CLOUD = fileURLToPath(new URL('../cloud/', import.meta.url));

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

/**
 * Reuses a running dev (:5173) / preview (:4173) server or spawns one.
 * SYN_PORT overrides the port — e.g. to run a long analysis against a
 * snapshot copy of the project while the working tree keeps changing.
 */
export async function ensureServer(preview) {
  const PORT = Number(process.env.SYN_PORT) || (preview ? 4173 : 5173);
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
  return withParam(url, 'res', res);
}

/** Sets one query parameter on a URL (no-op for an empty value), keeping the hash. */
export function withParam(url, key, value) {
  if (value === undefined || value === null || value === '' || value === 0) return url;
  const u = new URL(url);
  u.searchParams.set(key, String(value));
  return u.toString();
}

/**
 * Runs the points Worker (cloud/) locally in Miniflare with a fresh in-memory
 * D1 — so scripts exercise Share/open-link end to end without writing into
 * the production database. Needs `npm install` in cloud/ once.
 */
export async function startPointsWorker(port = 8787) {
  if (!existsSync(`${CLOUD}node_modules/miniflare`)) {
    throw new Error('cloud/node_modules missing — run `npm install` in cloud/ first');
  }
  execFileSync('npx', ['esbuild', 'src/index.ts', '--bundle', '--format=esm', '--platform=browser', '--outfile=dist/index.js', '--log-level=warning'], { cwd: CLOUD });
  const require = createRequire(`${CLOUD}package.json`);
  const { Miniflare, convertV4MiniflareOptions } = await import(pathToFileURL(require.resolve('miniflare')).href);
  const mf = new Miniflare(convertV4MiniflareOptions({
    modules: true,
    script: readFileSync(`${CLOUD}dist/index.js`, 'utf8'),
    compatibilityDate: '2026-09-01',
    port,
    bindings: { ALLOWED_ORIGINS: 'http://localhost:5173 http://localhost:4173' },
    d1Databases: ['DB'],
    ratelimits: {
      SAVE_LIMIT: { namespace_id: '1', simple: { limit: 1000, period: 60 } },
      READ_LIMIT: { namespace_id: '2', simple: { limit: 1000, period: 60 } },
    },
  }));
  const url = await mf.ready;
  const db = await mf.getD1Database('DB');
  const sql = readFileSync(`${CLOUD}migrations/0001_initial.sql`, 'utf8');
  for (const statement of sql.split('-- statement-breakpoint')) {
    const st = statement.replace(/^\s*--.*$/gm, '').trim();
    if (st) await db.prepare(st).run();
  }
  return { url: url.origin, db, stop: () => mf.dispose() };
}

export function captureErrors(page, errors, label = () => 'app') {
  page.on('pageerror', (e) => errors.push(`[${label()}] ${String(e)}`));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`[${label()}] ${m.text()}`); });
}
