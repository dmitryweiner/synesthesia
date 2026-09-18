# CLAUDE.md — project map for the agent

Synesthesia: one point in a ~500-gene space generates sound (formula
generators + FX, ported from [../formula-synth](../formula-synth/)) and an
image (Gray–Scott reaction-diffusion, ported from
[../chromaflux](../chromaflux/)) at the same time; the user steers the
search with 👍/👎. Decisions agreed with the user live in **PLAN.md** — read
it before changing behavior. README.md is the human-facing spec. UI, docs
and code comments are in English.

## Commands

```bash
npm run check     # tsc --noEmit && eslint . && vitest run — after every change
npm run smoke     # Playwright: boot, sound, 👍/👎/🎲/undo, every preset,
                  # ?preset=N, save+reload, share link in a 2nd tab, scout.
                  # The ONLY check of WebGL2/Web Audio (vitest can't load them)
npm run snap -- --out shots/x.png [--preset N] [--sound] [--like N] [--dislike N]
                  [--details] [--help] [--res N] [--wait ms]
npm run analyze   # fractality of the real sound (see "Sound analysis" below)
npm run build     # tsc + vite build into ./docs (GitHub Pages) — commit docs/
```

TDD: tests first, then code. Commits are allowed at milestone granularity
(brief). Reuse/extend `scripts/*.mjs` instead of writing one-off scripts.

## Headless browser gotchas (this machine: aarch64, SwiftShader)

- WebGL runs in software: 1–5 fps at 1024², cold first load ~17 s. Scripts
  pass `?res=128` (smoke default) — a big grid starves the CPU enough for a
  second tab's `goto` to time out.
- Never sleep for boot: `openApp()` in scripts/lib.mjs waits for
  `body[data-ready="1"]` (set at the end of `boot()` in main.ts). Fixed
  800 ms sleeps raced the help dialog, which opened after the click.
- Editing anything under `src/` or `index.html` makes Vite full-reload open
  pages — a running `analyze.mjs` dies with "Execution context was
  destroyed". Don't edit sources while it runs.
- `page.reload()` kills the AudioContext: re-start sound before checking it.

## Module map

```
src/dsp/generator.ts   21 formulas, per-sample, pure (1:1 port); block-rate
                       LFO modulation overwrite-then-restore in fill()
src/dsp/mod.ts         LFO (pure function of absolute time), effectiveParam(s).
                       ModRoute.target = 'fx' | formula id | visual card id —
                       the three namespaces never collide
src/dsp/gate.ts, rng.ts  fade gate for disabled generators; mulberry32 + gaussian
src/worklet/processors.ts  AudioWorklet wrapper (loaded via ?worker&url)
src/audio/engine.ts    AudioEngine: build(ctx) works on any BaseAudioContext;
                       start() = live AudioContext, renderOffline() = same graph
                       in an OfflineAudioContext with FX modulation scheduled
                       ahead (setInterval can't drive offline time).
                       applyFx() rebuilds routing only when the on/type/stage
                       key changes; applyFxParams() always smooths
                       (setTargetAtTime) because morphs push params at ~20 Hz
src/audio/features.ts  analyser → loudness / brightness / onset in [0,1]
src/audio/filters.ts, modrouting.ts  pure pieces of the engine (tested)
src/schema/audio.ts    formula sliders (+ `exp` flag for octave mutation),
                       FxState, modulatable-FX allowlist/ranges/modules
src/schema/visual.ts   cards: reaction, fieldVariation, flow, palette
                       (Veins/Pour/Brush deliberately not ported — PLAN.md #2)
src/sim/               SimEngine (WebGL2) + shaders + pure params; grid.ts
                       sizes the grid to the canvas aspect (square texels) and
                       shaders take uAspect so noise/spots stay isotropic
src/palette.ts         5 cosine palettes (order = PALETTE_NAMES)
src/state/schema.ts    AppState v1 {audio, visual, mod, coupling}; tolerant
                       sanitizeState + clamping stateToAppState; isModTarget
src/state/share.ts     #s=base64url(JSON); userPresets.ts → localStorage
                       key synesthesia_user_presets_v1
src/genome/genes.ts    GENES derived from the schemas: cont (normalized 0..1,
                       exp → log scale) / bool / choice, gated by activeIf;
                       MOD_TARGETS; ROUTE_SLOTS = 12
src/genome/codec.ts    AppState ⇄ Genome (masterGain/presetName aren't genes)
src/genome/evolve.ts   pure: mutate (sparse gaussian + momentum + one weighted
                       structural move; never touches inactive genes), repair
                       (1..5 formulas), randomGenome, lerpGenome (discrete genes
                       switch at t>0, but a closing gate stays open until t=1;
                       gated genes with `neutral` — formula gain, route depth,
                       FX wet mixes, flow/variation strengths — fade from/to
                       neutral as their gate opens/closes), diffSummary
src/genome/explorer.ts like/dislike/surprise/undo(5)/load; proposeLike/
                       proposeDislike preview without committing, like(p)/
                       dislike(p) commit a chosen one; `version` bumps per change
src/genome/scout.ts    background best-of-k (PLAN.md #7): renders parent + k
                       candidates per direction via an injected render (main.ts:
                       24 s @ 8 kHz, chosen with analyze.mjs --configs), scores
                       with analyzeSound, adjustedScore penalizes >6 dB quieter;
                       take() returns null for stale versions
src/analysis/          fft.ts (radix-2), fractal.ts (spectralSlope, higuchiFD,
                       boxCountDimension, analyzeSound, fractalScore)
src/coupling.ts        pure: features × coupling genes → card param offsets
                       (shift/lightAngle wrap, the rest clamp)
src/presets.ts         12 presets = formula-synth sound × chromaflux material,
                       with cross-domain LFO routes and coupling
src/ui/details.ts      read-only "what is this point" panel (+ fractality)
src/main.ts            wiring only: explorer → 2 s eased genome morph →
                       engines; shared LFO clock (audio.time when sound runs);
                       URL hash updated on settle; scout scheduled on settle
scripts/lib.mjs        server lifecycle, launchBrowser (CHROMIUM_PATH, autoplay,
                       SwiftShader), openApp (readiness), withRes
scripts/smoke.mjs      invariants only, never pixels; --mobile, --res, --screenshot
scripts/snap.mjs       one debug screenshot
scripts/analyze.mjs    offline render in the page (imports /src/*.ts from the dev
                       server) → metrics table; --mutants, --random, --configs
                       (Spearman of cheap windows vs the first), --wav, --json
```

## Sound analysis — what the numbers mean

`envβ`/`cenβ`: β of 1/f^β fitted on 0.05–5 Hz fluctuations of the loudness
(dB) / spectral-centroid (octaves) contours; contours flatter than 0.5 dB /
0.02 oct are "static" (NaN — a steady tone must not score). `box`: box-count
dimension of the loudest 20% of a 64-band log-frequency spectrogram.
`score` = (2·pref(envβ≈1) + 2·pref(cenβ≈1) + pref(box≈1.6)) / 5.

## Don'ts

- Don't add runtime dependencies or a UI framework.
- Don't make presets that fail `tests/presets.test.ts` (every value must
  survive sanitize+clamp unchanged; ≥1 visual route or coupling).
- Don't change GENES order casually: share links store AppState (not the
  genome), so they survive, but analysis JSON / tests assume stable ids.
