// Points Worker (PLAN.md decision 9): short share links for Synesthesia.
//   POST /v1/points      body = a point (AppState JSON, ≤ 16 KB)
//                        → 201 { id } (new) | 200 { id } (already stored)
//   GET  /v1/points/:id  → the stored point (immutable, cacheable forever)
//   GET  /v1/health
// The point is validated with the app's own sanitizeState/stateToAppState
// (imported from ../../src, bundled by esbuild) and stored as canonical JSON;
// the id is derived from that JSON (src/state/canonical.ts), so the same
// point always gets the same id and re-sharing is idempotent.
import { sanitizeState, stateToAppState } from '../../src/state/schema';
import { canonicalJson, isPresetId, presetIdOf } from '../../src/state/canonical';

interface Env {
  DB: D1Database;
  ALLOWED_ORIGINS: string;
  SAVE_LIMIT: RateLimit;
  READ_LIMIT: RateLimit;
}

const MAX_BODY = 16 * 1024;

class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

function fail(status: number, message: string): never {
  throw new HttpError(status, message);
}

function json(value: unknown, status = 200): Response {
  return Response.json(value, { status });
}

async function readBody(req: Request): Promise<string> {
  if (Number(req.headers.get('Content-Length')) > MAX_BODY) fail(413, 'point too large');
  if (!req.body) return '';
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > MAX_BODY) {
      await reader.cancel();
      fail(413, 'point too large');
    }
    chunks.push(value);
  }
  const all = new Uint8Array(size);
  let offset = 0;
  for (const c of chunks) {
    all.set(c, offset);
    offset += c.length;
  }
  return new TextDecoder().decode(all);
}

function clientKey(req: Request): string {
  return req.headers.get('CF-Connecting-IP') ?? 'unknown';
}

async function limit(rl: RateLimit, req: Request): Promise<void> {
  const { success } = await rl.limit({ key: clientKey(req) });
  if (!success) fail(429, 'too many requests');
}

async function savePoint(req: Request, env: Env): Promise<Response> {
  await limit(env.SAVE_LIMIT, req);
  const text = await readBody(req);
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    fail(400, 'invalid JSON');
  }
  const partial = sanitizeState(raw);
  if (!partial) fail(422, 'invalid point');
  const body = canonicalJson(stateToAppState(partial));
  const id = await presetIdOf(body);
  let res: D1Result;
  try {
    res = await env.DB.prepare('INSERT OR IGNORE INTO points (id, body, bytes, created) VALUES (?, ?, ?, ?)')
      .bind(id, body, body.length, Date.now() / 1000).run();
  } catch (err) {
    if (String(err).includes('points_quota')) fail(429, 'daily share quota reached, try tomorrow');
    throw err;
  }
  return json({ id }, (res.meta.changes ?? 0) > 0 ? 201 : 200);
}

async function loadPoint(req: Request, env: Env, id: string): Promise<Response> {
  await limit(env.READ_LIMIT, req);
  if (!isPresetId(id)) fail(404, 'point not found');
  const row = await env.DB.prepare('SELECT body FROM points WHERE id = ?').bind(id).first<{ body: string }>();
  if (!row) fail(404, 'point not found');
  return new Response(row.body, {
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=31536000, immutable' },
  });
}

async function route(req: Request, env: Env): Promise<Response> {
  const path = new URL(req.url).pathname;
  if (req.method === 'OPTIONS') return new Response(null, { status: 204 });
  if (path === '/v1/health' && req.method === 'GET') return json({ ok: true });
  if (path === '/v1/points') {
    if (req.method !== 'POST') fail(405, 'method not allowed');
    return savePoint(req, env);
  }
  if (path.startsWith('/v1/points/')) {
    if (req.method !== 'GET') fail(405, 'method not allowed');
    return loadPoint(req, env, path.slice('/v1/points/'.length));
  }
  fail(404, 'not found');
}

function allowedOrigins(env: Env): string[] {
  return (env.ALLOWED_ORIGINS || '').split(/\s+/).filter(Boolean);
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    let res: Response;
    try {
      res = await route(req, env);
    } catch (err) {
      res = err instanceof HttpError ? json({ detail: err.message }, err.status) : json({ detail: 'temporarily unavailable' }, 503);
    }
    // Stored responses carry their own caching; everything else is no-store.
    if (!res.headers.has('Cache-Control')) res.headers.set('Cache-Control', 'no-store');
    res.headers.set('X-Content-Type-Options', 'nosniff');
    res.headers.set('Vary', 'Origin');
    if (res.status === 429) res.headers.set('Retry-After', '3600');
    const origin = req.headers.get('Origin');
    if (origin && allowedOrigins(env).includes(origin)) {
      res.headers.set('Access-Control-Allow-Origin', origin);
      res.headers.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      res.headers.set('Access-Control-Allow-Headers', 'Content-Type');
      res.headers.set('Access-Control-Max-Age', '86400');
    } else if (req.method === 'GET' && new URL(req.url).pathname.startsWith('/v1/points/')) {
      res.headers.set('Access-Control-Allow-Origin', '*'); // points are public and immutable
    }
    return res;
  },
} satisfies ExportedHandler<Env>;
