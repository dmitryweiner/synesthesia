#!/usr/bin/env node
// A throwaway copy of the working tree in which every render's reverb room
// is SEEDED, so variants of a preset compare as pairs instead of through
// room noise. Measurement only — the app itself still builds a fresh random
// room per render (making that deterministic is PLAN-IMPROVEMENTS.md B1).
//
//   node .claude/skills/new-preset/seeded-snapshot.mjs <snapshot-dir>
//   cd <snapshot-dir> && node scripts/analyze.mjs --preset 12,13,14 --repeat 3 --wav <out>
//
// Render k of --repeat uses room seed k — the same rooms for every point —
// and its WAVs land in <out>/seed<k>/ (read them with bands.mjs). Why: with
// random rooms the same point read low-end roughness 0.046 and 0.034, more
// than the bass variants differed; with seeded rooms three seeds agreed on
// the ranking. Re-run this after editing the working tree (it re-syncs).
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const dest = process.argv[2] && resolve(process.argv[2]);
if (!dest) {
  console.error('usage: seeded-snapshot.mjs <snapshot-dir>');
  process.exit(1);
}
if (dest === resolve(ROOT) || dest.startsWith(`${resolve(ROOT)}/`)) {
  console.error('the snapshot must live outside the project (it is rsync --delete-ed)');
  process.exit(1);
}

execFileSync('rsync', ['-a', '--delete', '--exclude', 'node_modules', '--exclude', 'docs', '--exclude', 'shots', '--exclude', '.git', `${ROOT}`, `${dest}/`], { stdio: 'inherit' });
if (!existsSync(join(dest, 'node_modules'))) symlinkSync(join(ROOT, 'node_modules'), join(dest, 'node_modules'));

// Exact-text patches: if the code they anchor on has changed, stop loudly
// rather than measure an unpatched (random-room) tree.
function patch(file, pairs) {
  const path = join(dest, file);
  let s = readFileSync(path, 'utf8');
  for (const [from, to] of pairs) {
    if (!s.includes(from)) {
      console.error(`seeded-snapshot: anchor not found in ${file}:\n${from}\n— update this script to the new code`);
      process.exit(1);
    }
    s = s.replace(from, to);
  }
  writeFileSync(path, s);
}

patch('src/audio/engine.ts', [
  [
    '  const buf = ctx.createBuffer(2, len, sr);\n  for (let ch = 0; ch < 2; ch++) {',
    '  const buf = ctx.createBuffer(2, len, sr);\n'
    + '  // seeded-snapshot: the same room for the same seed\n'
    + '  let seed = (globalThis as unknown as { __irSeed?: number }).__irSeed ?? 12345;\n'
    + '  const rnd = (): number => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };\n'
    + '  for (let ch = 0; ch < 2; ch++) {',
  ],
  ['data[i] = (Math.random() * 2 - 1) * env;', 'data[i] = (rnd() * 2 - 1) * env;'],
]);

patch('scripts/analyze.mjs', [
  [
    "    const r = await page.evaluate(async ({ state, secs, sr, wantWav }) => {\n      const { AudioEngine }",
    "    const r = await page.evaluate(async ({ state, secs, sr, wantWav, rep }) => {\n"
    + '      globalThis.__irSeed = 1000 + rep * 7919; // seeded-snapshot\n'
    + '      const { AudioEngine }',
  ],
  [
    "wantWav: rep === 0 && flags.has('wav') && c.group !== 'mutant' });",
    "wantWav: flags.has('wav') && c.group !== 'mutant', rep });\n"
    + "    if (r.wav) writeWav(`${flags.get('wav')}/seed${rep}`, c.label, r.wav); // seeded-snapshot",
  ],
]);

console.log(`seeded snapshot ready: ${dest}
  cd ${dest} && node scripts/analyze.mjs --preset … --repeat 3 --wav <out>
  node ${join(ROOT, '.claude/skills/new-preset/bands.mjs')} <out>/seed0`);
