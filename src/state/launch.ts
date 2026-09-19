// What the page URL asks to open, and how it's rewritten (pure). Priority:
// ?presetId=<cloud id> > #s=<long token> (old links) > ?preset=<n> > none
// (then the app restores the last point from localStorage). The address bar
// no longer carries the current point (PLAN.md decision 9): cleanUrl drops
// the point parameters and keeps settings like ?res / ?scout / ?api.
import { isPresetId } from './canonical';
import { tokenFromHash } from './share';

export type Launch =
  | { kind: 'presetId'; id: string }
  | { kind: 'token'; token: string }
  | { kind: 'preset'; index: number }
  | { kind: 'none' };

const POINT_PARAMS = ['presetId', 'preset'] as const;

export function parseLaunch(href: string): Launch {
  const url = new URL(href);
  const id = url.searchParams.get('presetId');
  if (id !== null && isPresetId(id)) return { kind: 'presetId', id };
  const token = tokenFromHash(url.hash);
  if (token) return { kind: 'token', token };
  const preset = url.searchParams.get('preset');
  if (preset !== null && /^\d+$/.test(preset)) return { kind: 'preset', index: Number(preset) };
  return { kind: 'none' };
}

export function cleanUrl(href: string): string {
  const url = new URL(href);
  for (const p of POINT_PARAMS) url.searchParams.delete(p);
  url.hash = '';
  return url.toString();
}

export function withPresetId(href: string, id: string): string {
  const url = new URL(cleanUrl(href));
  url.searchParams.set('presetId', id);
  return url.toString();
}
