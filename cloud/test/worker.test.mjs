// Worker contract tests in Miniflare (workerd + local D1), like
// ../monitoring/cloud. Run with `npm test` (builds dist/index.js first).
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';

const ORIGIN = 'https://dmitryweiner.github.io';
let mf;
let db;

async function call(path, options = {}) {
  return mf.dispatchFetch(`https://points.test${path}`, options);
}

function post(body, headers = {}) {
  return call('/v1/points', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: ORIGIN, ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

before(async () => {
  const script = await readFile(new URL('../dist/index.js', import.meta.url), 'utf8');
  mf = new Miniflare(convertV4MiniflareOptions({
    modules: true,
    script,
    compatibilityDate: '2026-09-01',
    bindings: { ALLOWED_ORIGINS: `${ORIGIN} http://localhost:5173` },
    d1Databases: ['DB'],
    ratelimits: {
      SAVE_LIMIT: { namespace_id: '1', simple: { limit: 1000, period: 60 } },
      READ_LIMIT: { namespace_id: '2', simple: { limit: 1000, period: 60 } },
    },
  }));
  db = await mf.getD1Database('DB');
  const sql = await readFile(new URL('../migrations/0001_initial.sql', import.meta.url), 'utf8');
  for (const statement of sql.split('-- statement-breakpoint')) {
    const s = statement.replace(/^\s*--.*$/gm, '').trim();
    if (s) await db.prepare(s).run();
  }
});
after(async () => { await mf?.dispose(); });

test('health', async () => {
  const res = await call('/v1/health');
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true });
});

test('a point is normalized, stored once, and readable by its short id', async () => {
  const point = { presetName: 'Test point', audio: { formulas: { fm: { enabled: true, params: { fc: 330 } } } } };
  const first = await post(point);
  assert.equal(first.status, 201, await first.clone().text());
  const { id } = await first.json();
  assert.match(id, /^[0-9A-Za-z]{10}$/);
  const again = await post(point);
  assert.equal(again.status, 200);
  assert.equal((await again.json()).id, id);
  assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM points').first()).n, 1);

  const got = await call(`/v1/points/${id}`);
  assert.equal(got.status, 200);
  assert.match(got.headers.get('Cache-Control'), /immutable/);
  const state = await got.json();
  assert.equal(state.presetName, 'Test point');
  assert.equal(state.audio.formulas.fm.enabled, true);
  assert.equal(state.audio.formulas.fm.params.fc, 330);
  assert.equal(state.audio.formulas.fm.params.I, 3); // filled from defaults
  assert.ok(state.visual.cards.reaction, 'normalized to a full state');

  const other = await post({ ...point, presetName: 'Another' });
  assert.notEqual((await other.json()).id, id);
});

test('junk is stripped, out-of-range values clamped before storing', async () => {
  const res = await post({ evil: '<script>', audio: { masterGain: 99, formulas: { bogus: {}, fm: { enabled: true, params: { fc: 1e9 } } } } });
  const { id } = await res.json();
  const state = await (await call(`/v1/points/${id}`)).json();
  assert.equal(state.evil, undefined);
  assert.equal(state.audio.formulas.bogus, undefined);
  assert.equal(state.audio.masterGain, 1);
  assert.equal(state.audio.formulas.fm.params.fc, 2000);
});

test('rejects malformed input', async () => {
  assert.equal((await post('{not json')).status, 400);
  assert.equal((await post('"a string"')).status, 422);
  assert.equal((await post('x'.repeat(20000))).status, 413);
  assert.equal((await call('/v1/points/../../etc')).status, 404);
  assert.equal((await call('/v1/points/AAAAAAAAAA')).status, 404);
  assert.equal((await call('/v1/points', { method: 'GET' })).status, 405);
  assert.equal((await call('/nope')).status, 404);
});

test('CORS: allowed origins get preflight + headers, others do not', async () => {
  const pre = await call('/v1/points', {
    method: 'OPTIONS',
    headers: { Origin: ORIGIN, 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'content-type' },
  });
  assert.equal(pre.status, 204);
  assert.equal(pre.headers.get('Access-Control-Allow-Origin'), ORIGIN);
  assert.match(pre.headers.get('Access-Control-Allow-Methods'), /POST/);
  assert.match(pre.headers.get('Access-Control-Allow-Headers'), /Content-Type/i);
  const ok = await post({ presetName: 'cors' });
  assert.equal(ok.headers.get('Access-Control-Allow-Origin'), ORIGIN);
  const evil = await post({ presetName: 'cors' }, { Origin: 'https://evil.test' });
  assert.equal(evil.headers.get('Access-Control-Allow-Origin'), null);
  // points are public and immutable: any origin may read them
  const { id } = await ok.json();
  const read = await call(`/v1/points/${id}`, { headers: { Origin: 'https://elsewhere.test' } });
  assert.equal(read.headers.get('Access-Control-Allow-Origin'), '*');
});

test('daily quota blocks new points but never re-shares of existing ones', async () => {
  const res = await post({ presetName: 'before quota' });
  const { id } = await res.json();
  const day = Math.floor(Date.now() / 1000 / 86400);
  await db.prepare('INSERT INTO daily VALUES (?, 5000) ON CONFLICT(day) DO UPDATE SET count = 5000').bind(day).run();
  const blocked = await post({ presetName: 'over quota' });
  assert.equal(blocked.status, 429);
  assert.equal(blocked.headers.get('Retry-After'), '3600');
  const again = await post({ presetName: 'before quota' });
  assert.equal(again.status, 200);
  assert.equal((await again.json()).id, id);
  await db.prepare('DELETE FROM daily').run();
});
