// base64url state token for share links (#s=...).
import type { AppState, PartialAppState } from './schema';
import { sanitizeState } from './schema';

export function b64urlEncode(str: string): string {
  const bytes = new TextEncoder().encode(str);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function b64urlDecode(b64u: string): string {
  const b64 = b64u.replace(/-/g, '+').replace(/_/g, '/');
  const pad = b64.length % 4 ? '='.repeat(4 - (b64.length % 4)) : '';
  const bin = atob(b64 + pad);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

export function encodeStateToken(state: AppState): string {
  return b64urlEncode(JSON.stringify(state));
}

export function decodeStateToken(token: string): PartialAppState | null {
  try {
    return sanitizeState(JSON.parse(b64urlDecode(token)));
  } catch {
    return null;
  }
}

/** Pulls the token out of a "#s=..." string (or a full URL hash). */
export function tokenFromHash(hash: string): string | null {
  const m = hash.match(/#s=([A-Za-z0-9\-_]+)/);
  return m ? m[1] : null;
}
