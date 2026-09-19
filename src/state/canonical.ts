// Canonical JSON + content-addressed point ids (PLAN.md decision 9). Shared
// by the app and the Cloudflare Worker (cloud/src/index.ts), so both derive
// the same id from the same point: first 10 base62 characters of SHA-256 of
// the canonical JSON. Pure; Web Crypto exists in browsers, Workers and Node.

export const PRESET_ID_LENGTH = 10;
const BASE62 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
const ID_RE = /^[0-9A-Za-z]{10}$/;

/** JSON with object keys sorted at every depth (arrays keep their order). */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

/** 10-character base62 id of a canonical JSON string (≈59.5 bits of SHA-256). */
export async function presetIdOf(canonical: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical)));
  let n = 0n;
  for (let i = 0; i < 8; i++) n = (n << 8n) | BigInt(digest[i]);
  let out = '';
  for (let i = 0; i < PRESET_ID_LENGTH; i++) {
    out = BASE62[Number(n % 62n)] + out;
    n /= 62n;
  }
  return out;
}

export function isPresetId(s: string): boolean {
  return ID_RE.test(s);
}
