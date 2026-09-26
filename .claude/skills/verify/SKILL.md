---
name: verify
description: Run Synesthesia's verification ladder before committing or pushing — unit tests, types, lint, the Cloudflare Worker tests, the browser smoke (desktop / mobile / production build) and a screenshot — and explain what a failure usually means here. Use after changing anything in src/, cloud/, index.html or scripts/, and before any commit, build or push.
---

# Verify a change

Run only the rungs a change can break, cheapest first, and read the failures
with the notes below — most "failures" here are the harness, not the app.

## 1. Always: types, lint, unit tests

```bash
npm run check          # tsc --noEmit && eslint . && vitest run  (~15 s)
```

Notable suites: `continuity` (phase continuity — never let an oscillator go
back to `sin(2π·f·t)`), `onsets` (the picture must react to bells/drops),
`presets` (every preset survives sanitize+clamp, sounds, meets the coupling
floor), `scout`, `genome`, `sharelink`.

## 2. If `cloud/` or `src/state/{schema,canonical}.ts` changed

```bash
npm run check:cloud    # Worker tsc + Miniflare tests (~30 s)
```

The Worker bundles those two modules: changing validation changes what the
Worker accepts, so redeploy (`npm run deploy:cloud`) after such a change.

## 3. Browser smoke — the only check of WebGL2 + Web Audio

```bash
npm run smoke                         # desktop, dev server (~5–8 min here)
npm run smoke -- --mobile             # 390×844 layout
npm run smoke -- --preview --mobile   # against the ./docs production build
npm run smoke -- --screenshot shots/smoke.png
```

It starts the points Worker locally (Miniflare, in-memory D1) — it never
writes to production. It fails on any console/page error.

## 4. Look at it

```bash
npm run snap -- --out shots/x.png --res 256 --sound --details --wait 15000
```

Then read the PNG. Stills can't show pulse/flash — for those, measure
(see the `sound-check` skill) or read `body[data-fx-hits]` /
`body[data-fx-exposure]`.

## 5. Build + commit

```bash
npm run build          # tsc + vite build into ./docs — commit docs/ too
```

Commit at milestone granularity; put agreed decisions in PLAN.md. Push only
when the user asks. After a push, GitHub Pages rebuilds: check
`gh run list --limit 2` and the live site.

## When something fails

- **Smoke times out on boot** → never sleep for boot; `openApp()` waits for
  `body[data-ready="1"]`. Headless is ~5 fps (SwiftShader), first load ~17 s.
- **A second tab's `goto` times out** → the sim is starving the CPU; scripts
  pass `?res=128`.
- **"Execution context was destroyed"** → something edited `src/` while a
  script was running (Vite full-reloads). Run it from a snapshot copy
  (AGENTS.md) — it starts its own server there.
- **Point comparison differs** → compare with a tolerance; the genome codec
  moves the 15th digit.
- **Audio checks after `page.reload()`** → the AudioContext is gone; restart
  sound first.
- **Onset/hit counts look low in the browser** → headless frame rate, not the
  app: the 60 fps truth is `tests/onsets.test.ts` and `analyze.mjs --onsets`.
