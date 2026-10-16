// Client of the points Worker (cloud/, PLAN.md decision 9): POST a point →
// short content-addressed id; GET an id → the point. fetch is injectable for
// tests; every request has a timeout so a dead network never hangs Share.
import type { AppState } from './types';
import { isPointId, pointIdOf, sanitize } from '../core/point';

export const PRESETS_API = 'https://synesthesia-presets.dmitry-weiner.workers.dev';

export interface CloudOptions {
  fetch?: typeof fetch;
  api?: string;
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 6000;

async function request(path: string, init: RequestInit, opts: CloudOptions): Promise<Response> {
  const f = opts.fetch ?? fetch;
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), opts.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  try {
    return await f(`${opts.api ?? PRESETS_API}${path}`, { ...init, signal: ctl.signal });
  } finally {
    clearTimeout(timer);
  }
}

function isRecord(u: unknown): u is Record<string, unknown> {
  return typeof u === 'object' && u !== null;
}

/** The server stored something other than the point it was sent: its core
 *  is older than the page's and dropped what it does not know (2026-10-16:
 *  a Worker from before the layers dropped `seq`). Redeploy the Worker. */
export class StaleServerError extends Error {
  constructor() {
    super('the points server is out of date: it would not store the whole point');
    this.name = 'StaleServerError';
  }
}

/** Stores the point; resolves to its short id. Rejects on network/HTTP/format
 *  errors, and with a StaleServerError when the server's id is not the point's. */
export async function sharePoint(state: AppState, opts: CloudOptions = {}): Promise<string> {
  const res = await request('/v1/points', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(state),
  }, opts);
  if (!res.ok) throw new Error(`share failed: HTTP ${res.status}`);
  const body: unknown = await res.json();
  const id = isRecord(body) ? body.id : undefined;
  if (typeof id !== 'string' || !isPointId(id)) throw new Error('share failed: malformed reply');
  // The id is the hash of what was stored; ours is the hash of the whole point.
  if (id !== pointIdOf(state)) throw new StaleServerError();
  return id;
}

/** The point behind an id (sanitized by the core), or null if it doesn't exist / can't be read. */
export async function fetchPoint(id: string, opts: CloudOptions = {}): Promise<AppState | null> {
  if (!isPointId(id)) return null;
  try {
    const res = await request(`/v1/points/${id}`, { method: 'GET' }, opts);
    if (!res.ok) return null;
    return sanitize(await res.json());
  } catch {
    return null;
  }
}
