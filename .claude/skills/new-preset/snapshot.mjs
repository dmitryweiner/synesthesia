#!/usr/bin/env node
// A throwaway copy of the working tree to run long analyses from: editing
// src/ makes Vite reload the page, and a running analyze.mjs dies with it
// ("Execution context was destroyed"). The copy has its own checkout, so
// analyze.mjs starts its own server there, on a free port.
//
//   node .claude/skills/new-preset/snapshot.mjs <snapshot-dir>
//   cd <snapshot-dir> && node scripts/analyze.mjs --preset 12,13,14 --repeat 3 --wav <out>
//
// Renders are repeatable in the app itself now (PLAN.md #21: the reverb
// room and the noise formulas are seeded), so the copy needs no patches:
// render k of --repeat uses seed k for every point, and its WAVs land in
// <out>/seed<k>/ (read them with bands.mjs). Re-run this after editing the
// working tree (it re-syncs).
import { execFileSync } from 'node:child_process';
import { existsSync, symlinkSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const dest = process.argv[2] && resolve(process.argv[2]);
if (!dest) {
  console.error('usage: snapshot.mjs <snapshot-dir>');
  process.exit(1);
}
if (dest === resolve(ROOT) || dest.startsWith(`${resolve(ROOT)}/`)) {
  console.error('the snapshot must live outside the project (it is rsync --delete-ed)');
  process.exit(1);
}

execFileSync('rsync', ['-a', '--delete', '--exclude', 'node_modules', '--exclude', 'docs', '--exclude', 'shots', '--exclude', '.git', `${ROOT}`, `${dest}/`], { stdio: 'inherit' });
if (!existsSync(join(dest, 'node_modules'))) symlinkSync(join(ROOT, 'node_modules'), join(dest, 'node_modules'));

console.log(`snapshot ready: ${dest}
  cd ${dest} && node scripts/analyze.mjs --preset … --repeat 3 --wav <out>
  node ${join(ROOT, '.claude/skills/new-preset/bands.mjs')} <out>/seed1`);
