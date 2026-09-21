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
   sibling repo (only `rec.mjs` with peak/RMS/click metrics). Written here
   instead: pure `src/analysis/fractal.ts` (β of the 1/f^β spectrum of the
   loudness and spectral-centroid contours, Higuchi dimension, box-counting
   dimension of the spectrogram → `fractalScore` in [0,1]) and
   `scripts/analyze.mjs`, which renders the app's real graph (worklets + FX +
   LFOs) through an OfflineAudioContext in headless Chromium. First run
   (30 s, 22 kHz): built-in presets 0.785 ± 0.14 vs random points
   0.552 ± 0.31; "Fractal garden" (hand-tuned for waterfall fractality in
   formula-synth) scores highest, 0.97. 👍/👎 proposals spread 0.34–0.98 and
   some drop 15–25 dB in loudness.
7. **Scout — fractality-guided proposals, ON by default** (agreed with the
   user, 2026-09-18). While sound is playing and the point has settled, the
   app renders the current point and 3 👍 + 3 👎 candidates offline (~8 s
   each, same graph), scores them and, on a press, commits the best-scored
   ready candidate (fractal score minus a penalty for being much quieter than
   the current point). Nothing ready → the usual instant proposal. Costs
   background CPU (offline rendering thread); `?scout=0` disables it.
   *Render window chosen by measurement* (`analyze.mjs --configs`, 5 presets
   × 4 proposals, Spearman ρ against a 30 s @ 22 kHz render): 8 s @ 16 kHz
   ρ = 0.23 (useless — slow LFOs don't fit), 16 s @ 11 kHz ρ = 0.63,
   **24 s @ 8 kHz ρ = 0.73** at about the same render cost (~2.4 s per
   candidate on the aarch64 dev box) → the scout uses 24 s @ 8 kHz.

## Decisions after user testing (agreed with the user, 2026-09-19)

8. **Make the sound → image link more explicit** (all four options chosen):
   - *Pulse*: loudness swells (loudness relative to its ~4 s average)
     breathe the picture's exposure/contrast, every onset flashes the
     highlight — display-level, reacts in the same frame.
   - *Onsets seed growth*: each detected onset (bell strike, drop, attack)
     drops fresh "ink" into the reaction at a random spot and sends a ripple
     out from it — you see new growth exactly when you hear the hit.
   - *Spectrum → colour*: bass / mid / treble energy tints the dark / mid /
     light tones of the palette (warm red → amber → cold cyan).
   - *Stronger by default*: presets get stronger coupling, and a floor keeps
     evolution from muting the link (the four explicit couplings above sum
     to ≥ 1.2 after every proposal).
   The new strengths are genes (`loudToPulse`, `onsetToFlash`,
   `onsetToSeed`, `spectrumToTint`, range 0..1) like the existing couplings.
   *Measured, not guessed:* `src/audio/analyserSim.ts` emulates the browser
   AnalyserNode, so `tests/onsets.test.ts` runs the live feature/onset
   pipeline on the presets' real audio. The first onset detector (flux over
   1024 linear bins, fixed gain) found 0 drops in *Cave coral* and 1 bell in
   16 s once reverb smeared the attacks; the adaptive detector (rise of 20
   log bands vs recent mean + 3·deviation), compared on real-graph renders of
   all 12 presets, finds ~14 drops / 20 s and every bell strike while steady
   drones stay at ≈1 (the start). Exposure now swings ≈0.85–1.45 on
   drones (was 0.97–1.26); smoothing is time-based so 30 fps devices react
   like 60 fps ones.
9. **Short share links via a Cloudflare Worker + D1** (same stack as
   ../monitoring). 🔗 Share POSTs the point to the Worker, which validates it
   with the app's own `sanitizeState`/`stateToAppState`, stores canonical
   JSON in D1 and returns an id; the link is `?presetId=<id>`.
   - *Id = content hash*: first 10 base62 characters of SHA-256 of the
     canonical (sorted-key) JSON — the same point always gets the same link,
     no duplicates, re-sharing is idempotent, ids can't be enumerated.
   - *Clean address bar*: the long `#s=` is no longer written to the URL; the
     current point survives a reload through localStorage
     (`synesthesia_last_point_v1`). After Share the address shows
     `?presetId=…` until the next step. Old `#s=` links keep opening. If the
     Worker is unreachable, Share falls back to copying the long `#s=` link.
   - Limits: 16 KB per point, per-IP rate limits, a daily insert cap; points
     are kept indefinitely (content-addressed, ~4 KB each).

## Bugs found after user testing (2026-09-19)

- **Harsh beating on preset switches / morphs / LFO routes — fixed.** The
  user heard it and couldn't remove it (suspected the previous preset still
  sounding). Root cause, proven by `tests/continuity.test.ts`: the oscillators
  ported from formula-synth computed `sin(2π·f·t)` from absolute time, so any
  frequency change jumped the phase by 2π·Δf·t — growing with how long the
  sound had played. With a slow shallow LFO on a frequency, 60 s after start
  FM/PM/beats/dist were 17–22× "rougher" (HF energy ratio), additive 5.7×,
  bells/quasi ~2×. All oscillators now accumulate phase; for constant params
  the sound is unchanged. (formula-synth has the same latent bug.)
- **Clicks and old tails on preset switch — fixed.** `analyze.mjs --switch`
  renders preset chains through the live `applyState` path offline: 2
  clicks at switches before, 0 after. A preset/link load is now a hard switch
  (`AudioEngine.switchTo`): master ducks (~20 ms), FX nodes are rebuilt so no
  delay/reverb tail of the old point pitch-warbles on, the new point is
  applied at once and fades in (~150 ms). Morph-time FX re-routing is done
  behind a short master dip.

## UI fixes after user testing (2026-09-21)

- **A saved point looked like it wasn't saved.** Saving while a built-in
  preset was selected suggested that preset's own name, so the copy showed up
  as e.g. "Molten Polivoks" inside *My points* — twelve rows below the
  identical built-in entry. Now: saved points are listed **first**, prefixed
  with 💾 and without an index; the suggested name is a fresh "Point N"
  unless you are overwriting one of your own points
  (`suggestPointName`); saving confirms in the status line.
- **Popups could only be closed from the toolbar.** The details panel got its
  own ✕ (and Escape closes it); the help dialog got a ✕ next to "Got it".
- **The help dialog didn't fit small phones**, which left no way to close it:
  it is now a flex column capped at 86vh with the text in a scrollable area
  and the button pinned below.
- **Saved points can be deleted** (🗑 next to the list). The button only
  exists while one of your own points is selected — a native `<select>`
  can't hold per-row buttons, and an always-present button pushed the phone
  toolbar into a second row. On phones the toolbar is now two deliberate
  rows: Sound + the point name (readable at last — it had been squeezed to
  28 px), then the icons.
- **Phones dimmed the screen while watching.** Screen Wake Lock
  (`src/ui/wakelock.ts`, ported from formula-synth) is taken on the first
  gesture and re-taken when the tab becomes visible again; it degrades
  silently where the API is missing or refused.

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
src/analysis/       pure signal metrics (fractality, clicks) used by
                    scripts/analyze.mjs and the scout
src/visualFx.ts     pure: explicit display effects (pulse, flash, tint,
                    ripples) from audio features × coupling genes
src/state/          + canonical (canonical JSON, content ids), launch (URL →
                    what to open), cloud (points Worker client), lastPoint
src/main.ts         wiring: engines, rAF loop, morphing, UI
cloud/              Cloudflare Worker + D1 for short share links
scripts/            smoke.mjs (Playwright, local Worker in Miniflare),
                    snap.mjs (screenshot), analyze.mjs (offline render +
                    metrics, --switch for preset-switch clicks)
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
1. Pure DSP + audio engine port (generator sanity, gate, mod, filters,
   modrouting, features) ✔
2. WebGL sim port (params, palette; aspect-correct grid) ✔
3. Schemas + state + share + user presets ✔
4. Genome codec + evolve + explorer (+ gate-aware morph fades) ✔
5. Combined presets (every preset round-trips, sounds, stays in range) ✔
6. Coupling + main.ts UI + smoke/snap scripts ✔
7. Fractality analysis module + analyze script + scout ✔
8. README, CLAUDE.md, build to docs ✔

## Backlog / ideas

- Fade discrete FX (filter on/off, type changes) with a crossfade instead
  of a switch at the start of the morph.
- Let the scout's window adapt to the device (render speed probe).
- A tiny live "fractality" meter from the analyser (rolling 30 s window).
