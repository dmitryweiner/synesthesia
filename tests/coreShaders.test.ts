// Until the swap (PLAN-CORE.md phase 9) the shaders exist twice: here in
// src/sim/shaders/, which the app still draws with, and in the core's
// shaders/ (C10), which the package from the pinned revision carries. They
// must not drift: change a shader in the core first, bump the pin, then
// copy it here.
import { readdirSync, readFileSync } from 'node:fs';

const here = new URL('../src/sim/shaders/', import.meta.url);
const core = new URL('../src/core/pkg/shaders/', import.meta.url);
const shaders = (dir: URL): string[] => readdirSync(dir).filter((f) => /\.(frag|glsl|vert)$/.test(f)).sort();

describe('the shaders', () => {
  it('are the same files in the app and in the pinned core', () => {
    expect(shaders(core)).toEqual(shaders(here));
  });

  it.each(shaders(here))('%s is identical to the core’s', (f) => {
    expect(readFileSync(new URL(f, core), 'utf8')).toBe(readFileSync(new URL(f, here), 'utf8'));
  });
});
