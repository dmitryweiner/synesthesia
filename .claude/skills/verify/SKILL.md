---
name: verify
description: Run Synesthesia's verification ladder before committing or pushing — unit tests, types, lint, the Cloudflare Worker tests, the browser smoke (desktop / mobile / production build) and a screenshot — and explain what a failure usually means here. Use after changing anything in src/, cloud/, index.html or scripts/, and before any commit, build or push.
---

# Verify a change

Run only the rungs a change can break, cheapest first, and read the failures
with the notes below — most "failures" here are the harness, not the app.

## 1. Always: types, lint, unit tests

```bash
npm run check          # builds the pinned core into src/core/pkg (npm run core),
                       # then tsc --noEmit && eslint . && vitest run  (~15 s)
```

The model is the core's now (PLAN-CORE.md): its own checks are
`../synesthesia-core/scripts/check.sh`. Here: `coreWorklet` (the worklet
loads without TextDecoder/TextEncoder, one output view, frames),
`coreFrames`, `scoutPool`, `settings` (slider math), `sharelink`. A change
to the core is made there first, pushed, and the pin in `package.json`
bumped (or tried with `SYN_CORE_DIR=../synesthesia-core npm run core`).

## 2. If `cloud/` changed, or the pinned core did

```bash
npm run check:cloud    # Worker tsc + Miniflare tests (~30 s)
```

The Worker validates with the core's wasm (sanitizePoint, pointId); its
tests post every point of the core's fixture (the production D1 points
included) and expect the ids they had. A change there changes what the
Worker stores: redeploy (`npm run deploy:cloud`) only by the user's go.

## 3. Browser smoke — the only check of WebGL2 + Web Audio

```bash
npm run smoke                         # desktop, dev server (~5–8 min here)
npm run smoke -- --mobile             # 390×844 layout
npm run smoke -- --preview --mobile   # against the ./dist production build
SMOKE_VERBOSE=1 npm run smoke         # say which step runs, every 30 s
npm run smoke -- --screenshot shots/smoke.png
```

It starts the points Worker locally (Miniflare, in-memory D1) — it never
writes to production. It fails on any console/page error. Its `features`
step needs headless Chromium's audio clock to run: if a fresh AudioContext
does not advance (this Mac's audio device stalled on 2026-10-06), that step
fails and nothing else does — it is the machine, not the app.

## 4. Look at it

```bash
npm run snap -- --out shots/x.png --res 256 --sound --details --wait 15000
```

Then read the PNG. Stills can't show pulse/flash — for those, measure
(synesthesia-core's `sound-check` skill) or read `body[data-fx-hits]` /
`body[data-fx-exposure]`.

## 5. Build + commit

```bash
npm run build          # core + tsc + vite build into ./dist (never committed)
```

Commit at milestone granularity; put agreed decisions in PLAN.md. Push only
when the user asks. CI (.github/workflows/pages.yml) runs the checks on
every push and deploys Pages from main: check `gh run list --limit 2`.

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
  app: the truth is the core's `tests/onsets.rs` and `syn-bench --onsets`.
- **The app plays another core than the pin says** → `src/core/pkg/REV`;
  `npm run core` rebuilds when it differs (and touches the checkout, since
  one cargo target dir serves every rev).
