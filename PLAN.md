# Synesthesia — plan & decisions

A browser app that generates **sound and image at the same time** from one
point in a multidimensional parameter space (the "genome"). The user gives
live feedback (like / dislike) and the app steers generation accordingly.
The current point can be saved to localStorage, shared via URL, and the
last few changes can be undone.

Built on two sibling projects: [../formula-synth](../formula-synth/) (audio:
formula generators + FX + LFO matrix) and [../chromaflux](../chromaflux/)
(image: Gray–Scott reaction-diffusion + curl advection + cosine palettes).
Their presets are reused as seeds — people liked them, so they are the
starting points of every exploration.

## Decisions (agreed with the user, 2026-09-18)

1. **Evolution model — directed search, not auto-drift, not A/B.**
   - 👍 *Like* = "keep going this way": the current point becomes the new
     anchor, the step that led here becomes the momentum direction, the next
     proposal continues along it with a *smaller* random spread.
   - 👎 *Dislike* = "go back and try elsewhere": revert to the last anchor
     (last liked point), propose a step in a *different* direction with a
     *larger* spread; momentum is discarded.
   - 🎲 *Surprise* = jump to a random built-in preset plus moderate noise.
   - Every press immediately yields a new proposal; the transition is a
     smooth ~2 s morph (continuous genes interpolate, discrete genes switch
     at the start of the morph).
   - ↩ *Undo* reverts the last change; history depth = 5.
   - Nothing changes without user input (LFO modulation and the simulation
     itself keep running, but the *point* is stable).
2. **Visual engine scope — core only:** Reaction + Field variation + Flow +
   Palette (5 cosine palettes). Veins (CPU crack walkers) and Pour
   (Cahn–Hilliard) are *not* ported: they tolerate continuous parameter
   mutation badly (Pour needs a reseed on parameter change; Veins accumulate
   forever). Brush is not ported (no pointer tool in this app). 10 of the 13
   ChromaFlux presets survive this cut.
3. **Audio → image coupling is live, and its weights are genes.** Features
   from the AnalyserNode (RMS loudness, spectral centroid, spectral flux /
   onsets) offset visual params every frame: loudness → flow/advection and
   gloss, timbre brightness → palette shift, onsets → light angle. Coupling
   strengths live in the genome, mutate with everything else, and are saved
   with the point. On top of that the LFO pool is *shared*: one LFO can
   drive both a synth parameter and an image parameter.
4. **Stack:** TypeScript + ESLint (no `as` casts, same rules as siblings),
   Vite, vitest, Playwright for browser smoke. No UI framework, no runtime
   deps. Build to `./docs` for GitHub Pages. UI, docs and code comments in
   English. TDD: tests are written before the code they cover.
5. **Commits are allowed** without asking (per the brief), at milestone
   granularity.
6. **Audio-analysis scripts** mentioned in the brief were not found in either
   sibling repo (only `rec.mjs` with peak/RMS/click metrics). A new
   `scripts/analyze.mjs` + pure `src/analysis/` module (spectral slope,
   Higuchi fractal dimension of the envelope) is written here instead.

## Architecture

```
src/dsp/            pure DSP: generator (21 formulas), gate, mod (LFO), rng
src/worklet/        AudioWorklet processor entry (generator only)
src/audio/          AudioEngine (FX chain, worklet nodes), filters,
                    modrouting, features (analyser → loudness/centroid/flux)
src/gl/             WebGL2 helpers (context, fullscreen quad, ping-pong)
src/sim/            Gray–Scott engine + shaders + pure params
src/palette.ts      cosine palettes
src/schema/         UI-less parameter schemas: audio (formulas + FX ranges),
                    visual (cards)
src/genome/         genes (flat list of typed genes derived from schemas),
                    codec (AppState ⇄ Genome), evolve (pure proposals),
                    explorer (like/dislike/surprise/undo bookkeeping)
src/coupling.ts     pure: audio features × coupling genes → visual offsets
src/state/          AppState v1, tolerant sanitize, share token, user presets
src/presets.ts      combined audio+image+mod+coupling presets
src/analysis/       pure signal metrics used by scripts/analyze.mjs
src/main.ts         wiring: engines, rAF loop, morphing, UI
scripts/            smoke.mjs (Playwright), snap.mjs (screenshot),
                    analyze.mjs (record + metrics)
```

### Genome

A `number[]` indexed by `GENES: GeneDef[]`. Gene kinds: `cont` (stored
normalized in [0,1]; `exp` genes map through log scale), `bool` (0/1),
`choice` (integer index). Every gene may have `activeIf` — the id of a bool
gene that gates it (a disabled formula's params, an off card's params, an
unused route slot). Mutation only touches *active* continuous genes, plus a
small probability of one *structural* move (toggle a formula/FX/card, change
palette/filter type, enable/retarget a route slot).

Constraints enforced after every proposal: 1..5 formulas enabled.

### AppState (v1, serializable, also the live state)

```
{ v: 1, presetName?, audio: { masterGain, fx, formulas }, visual: { cards },
  mod: { lfos[4], routes[] }, coupling: { ... } }
```

Routes target `'fx'`, a formula id, or a card id (`target` field); ids never
collide across the three namespaces.

## Phases

0. Scaffold (package.json, tsconfig, eslint, vite, PLAN.md) ✔
1. Pure DSP + audio engine port (tests: generator sanity, gate, mod,
   filters, modrouting, features)
2. WebGL sim port (tests: params, palette)
3. Schemas + state + share + user presets (tests)
4. Genome codec + evolve + explorer (tests)
5. Combined presets (tests: every preset round-trips, sounds, stays in range)
6. Coupling + main.ts UI + smoke script
7. Analysis module + script, README, CLAUDE.md, build to docs, commit
