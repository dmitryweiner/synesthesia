// How the page URL is rewritten (pure). What it asks to open is the core's
// parse_launch (src/core/session.ts). The address bar no longer carries the
// current point (PLAN.md decision 9): cleanUrl drops the point parameters
// and keeps settings like ?res / ?scout / ?api. A link that names the point
// playing — ?presetId= after a share or an opened link, ?preset=N for a
// built-in — stays until the first step away from it (PLAN.md #33).
const POINT_PARAMS = ['presetId', 'preset'] as const;

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

export function withPreset(href: string, index: number): string {
  const url = new URL(cleanUrl(href));
  url.searchParams.set('preset', String(index));
  return url.toString();
}
