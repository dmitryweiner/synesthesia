#!/usr/bin/env node
// Puts the sample bank the layers play (synesthesia-core
// PLAN-SAMPLES-SCRIPTS.md S7) into public/bank.bin, where the page fetches
// it. The bank is synesthesia-samples' release asset, pinned in
// package.json ("synesthesiaSamples": its URL and SHA-256); it is never
// committed here. Downloaded once into .bank/<sha256>.bin and checked.
//
//   node scripts/fetch-bank.mjs     # no-op when public/bank.bin is the pinned one
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const { bank: url, sha256 } = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).synesthesiaSamples;
const OUT = join(ROOT, 'public', 'bank.bin');
const CACHE = join(ROOT, '.bank', `${sha256}.bin`);
const hash = (b) => createHash('sha256').update(b).digest('hex');

if (existsSync(OUT) && hash(readFileSync(OUT)) === sha256) process.exit(0);
if (!existsSync(CACHE) || hash(readFileSync(CACHE)) !== sha256) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  const bytes = Buffer.from(await res.arrayBuffer());
  if (hash(bytes) !== sha256) throw new Error(`${url}: sha256 ${hash(bytes)}, package.json pins ${sha256}`);
  mkdirSync(dirname(CACHE), { recursive: true });
  writeFileSync(CACHE, bytes);
}
copyFileSync(CACHE, OUT);
console.log(`bank ${sha256.slice(0, 12)} → public/bank.bin`);
