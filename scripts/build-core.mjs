#!/usr/bin/env node
// Builds the core's wasm package (synesthesia-core/syn-wasm), with the
// core's shaders beside it, into src/core/pkg/ — PLAN-CORE.md C3/C9. The web app pins a core revision in
// package.json ("synesthesiaCore.rev"); the package is built from exactly
// that revision and never committed. Needs Rust with the wasm32 target and
// wasm-pack (`rustup target add wasm32-unknown-unknown`,
// `cargo install wasm-pack`).
//
//   node scripts/build-core.mjs            # no-op when the pinned rev is built
//   SYN_CORE_DIR=../synesthesia-core node scripts/build-core.mjs
//       # build a working tree instead of the pin — trying a core change
//       # before pushing it (Android's local [patch]); always rebuilds
//
// The pinned revision is checked out into .core/<rev> from the sibling
// checkout ../synesthesia-core when it has that commit (fast, and works for
// a commit not pushed yet), else from the repository in package.json.
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, readFileSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'src/core/pkg');
const STAMP = join(OUT, 'REV');
const { repo, rev } = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).synesthesiaCore;

// cargo's own directory is often not on a non-login shell's PATH.
const env = { ...process.env, PATH: `${join(homedir(), '.cargo/bin')}:${process.env.PATH}` };
const run = (cmd, args, cwd) => execFileSync(cmd, args, { cwd, env, stdio: 'inherit' });
const quiet = (cmd, args, cwd) => {
  try { execFileSync(cmd, args, { cwd, env, stdio: 'ignore' }); return true; } catch { return false; }
};

function build(coreDir, stamp, targetDir) {
  rmSync(OUT, { recursive: true, force: true });
  if (targetDir) env.CARGO_TARGET_DIR = targetDir; // one cache for every pinned rev
  run('wasm-pack', ['build', 'syn-wasm', '--target', 'web', '--release', '--no-pack', '--out-dir', OUT], coreDir);
  // the picture's shaders travel with the package (PLAN-CORE.md C10)
  cpSync(join(coreDir, 'shaders'), join(OUT, 'shaders'), { recursive: true });
  // the points the TypeScript froze, ids included: the points Worker's tests
  // check that the Worker on wasm still gives every one of them its id (C5)
  cpSync(join(coreDir, 'fixtures', 'points.json'), join(OUT, 'fixtures', 'points.json'));
  writeFileSync(STAMP, `${stamp}\n`);
  console.log(`syn-wasm ${stamp} → src/core/pkg`);
}

const local = process.env.SYN_CORE_DIR;
if (local) {
  build(resolve(ROOT, local), `local:${resolve(ROOT, local)}`);
} else if (existsSync(STAMP) && readFileSync(STAMP, 'utf8').trim() === rev) {
  // already built at the pin
} else {
  const src = join(ROOT, '.core', rev);
  if (!existsSync(join(src, 'Cargo.toml'))) {
    mkdirSync(join(ROOT, '.core'), { recursive: true });
    const sibling = join(ROOT, '../synesthesia-core');
    const from = quiet('git', ['-C', sibling, 'cat-file', '-e', `${rev}^{commit}`]) ? sibling : repo;
    rmSync(src, { recursive: true, force: true });
    run('git', ['clone', '--quiet', '--no-checkout', from, src]);
    run('git', ['-c', 'advice.detachedHead=false', 'checkout', '--quiet', rev], src);
  }
  // Every pinned rev shares one cargo target dir, and cargo trusts file
  // times: a checkout older than the last build would be taken as built and
  // hand back ANOTHER rev's package. Touching its sources makes them newest.
  run('find', [src, '-path', `${src}/target`, '-prune', '-o', '-name', '*.rs', '-exec', 'touch', '{}', '+'], src);
  build(src, rev, join(ROOT, '.core', 'target'));
}
