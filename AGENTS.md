# AGENTS.md — project map and working rules

(Claude Code reads CLAUDE.md, which points here; keep everything in this
one file so the two never drift apart.)

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
npm run analyze   # fractality of the real sound (see "Sound analysis" below);
                  # --onsets: onset hits per preset at 60/30/15 fps (the
                  #   picture seeds growth on every hit — tune the detector here);
                  # --switch 0,3,10 --at 12: clicks at preset switches;
                  # --configs 30@22050,24@8000: does a cheap render rank like
                  #   an expensive one (Spearman ρ)?
npm run build     # tsc + vite build into ./docs (GitHub Pages) — commit docs/
npm run check:cloud   # cloud/ Worker: tsc + Miniflare tests (npm install in cloud/ once)
npm run deploy:cloud  # D1 migrations --remote + wrangler deploy (wrangler is authorized)
```

TDD: tests first, then code. Commits are allowed at milestone granularity
(brief). Reuse/extend `scripts/*.mjs` instead of writing one-off scripts.
Agreed decisions go into PLAN.md (numbered, dated) — the user asks for that.

Two skills carry the routines: **`verify`** (which checks to run before a
commit and how to read their failures) and **`sound-check`** (how to measure
the actual sound and tune thresholds on real renders).

## How work is done here — measure first

Sound and generative images can't be judged from a screenshot, and this
machine has no speakers: **build the measurement before changing the
behaviour.** Every good decision in this project came from a number, and
every guess cost a round trip:

| question | measurement | result |
|---|---|---|
| does the scout's cheap render rank candidates like a long one? | `analyze.mjs --configs` (Spearman ρ) | 8 s @ 16 kHz ρ=0.23 → useless; 24 s @ 8 kHz ρ=0.73 at the same cost |
| does the picture react to a bell/drop? | `analyze.mjs --onsets`, `tests/onsets.test.ts` | old detector 0 drops / 1 bell; adaptive one 14 / 10 per 20 s |
| what did the user's "harsh beating" come from? | `tests/continuity.test.ts` (HF roughness ratio) | absolute-time oscillators: ×17–22 rougher after 60 s |
| do preset switches click? | `analyze.mjs --switch` | 2 clicks → 0 after switchTo() |
| are the built-in presets actually "fractal"? | `analyze.mjs --random 12` | presets 0.79±0.14 vs random 0.55±0.31 |

Corollaries:
- A metric that runs in vitest beats one that needs a browser: the pure
  `analyserSim.ts` lets unit tests run the *live* feature pipeline on
  rendered audio.
- Keep the bench: put it in `scripts/analyze.mjs` behind a flag, not in a
  throwaway script — the next tuning session starts from numbers, not zero.
- State thresholds as behaviour ("a bell every 4 s → 3–6 hits in 16 s"), so
  a future change that breaks the *feel* fails a test.

## Test-harness pitfalls that already cost time

- **Render whole blocks.** `SR * seconds` is usually not a multiple of 128;
  a truncated last block drops samples between two `fill()` runs and fakes a
  discontinuity (a "click" that isn't there).
- **Median-relative detectors can't see per-frame damage.** `detectClicks`
  finds isolated clicks; an artifact that happens on *every* audio block
  lifts the median instead. Use a relative measure (HF roughness with vs
  without modulation) for continuous damage.
- **Compare points with a tolerance.** A point that went through the genome
  codec differs in the 15th digit (`55 → 55.00000000000001`); compare
  parsed values rounded to ~9 significant digits, never JSON strings.
- **localStorage is shared by every tab** of a browser context: one tab's
  last point is what another tab's reload restores.
- **Wake lock is refused in headless** (`NotAllowedError`) unless the context
  grants `screen-wake-lock`; the smoke grants it and then asserts
  `body[data-awake]`.
- **Popups must be closable from themselves** (✕ on the panel, Escape), and
  must fit a 390×560 screen — a dialog taller than the viewport hides its own
  button. The smoke measures both.
- **The phone toolbar is two rows by design** (Sound + point name, then the
  icons): flex `order` + a `#topbar::after` line break. Adding another
  always-visible button squeezes the `<select>` to an unreadable stub —
  measure `#presetSel` width at 390 px after touching the toolbar.
- **Long analysis runs die when you edit `src/`** (Vite full-reloads the
  page). Run them against a snapshot on another port instead:
  `rsync -a --exclude node_modules --exclude docs --exclude shots --exclude .git ./ $SNAP/`,
  symlink `node_modules`, then `SYN_PORT=5180 node scripts/analyze.mjs …`
  from the snapshot.

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
- ~5 fps headless means most onsets fall between frames: live probes
  undercount hits. The 60 fps truth is `tests/onsets.test.ts` (pure
  AnalyserNode emulation over real preset audio).
- localStorage is shared by all tabs of a context: the last point written by
  one tab is what another tab's reload restores.

## Cloud — short share links (PLAN.md #9)

- Worker `synesthesia-presets` → https://synesthesia-presets.dmitry-weiner.workers.dev,
  D1 `synesthesia-presets` (id 0a0f3551-69bb-4b0c-8e7f-7efe516a9535),
  rate-limit namespaces 2001/2002, same account as ../monitoring. Resources
  exist and the migration is applied — never recreate them.
- `cloud/src/index.ts` imports `src/state/schema.ts` + `canonical.ts`: one
  validation and one id function for app and server. Changing AppState
  sanitization changes what the Worker accepts — redeploy after such changes.
- Migration SQL: inside triggers write `SELECT (CASE … END);` — without the
  parentheses wrangler's splitter takes `END;` for the end of the trigger
  ("incomplete input").
- npm 11 blocks the esbuild/workerd postinstall scripts; not needed — the
  platform packages carry the binaries (Miniflare runs fine on aarch64).
- `scripts/smoke.mjs` starts the Worker locally (`startPointsWorker()` in
  lib.mjs, in-memory D1) and passes `?api=http://localhost:8787`; the app
  honors `?api=` only for localhost. Never point scripts at production.

## Module map

```
src/dsp/generator.ts   21 formulas, per-sample, pure; block-rate LFO modulation
                       overwrite-then-restore in fill(). EVERY oscillator
                       accumulates phase (ph1..ph4, rissPhases): the ported
                       sin(2π·f·t) jumped phase by 2π·Δf·t on any frequency
                       change → harsh beating after minutes (user report,
                       PLAN.md "Bugs"). gliss: log-frequency state, restarts
                       after 4 octaves
src/dsp/mod.ts         LFO (pure function of absolute time), effectiveParam(s).
                       ModRoute.target = 'fx' | formula id | visual card id —
                       the three namespaces never collide
src/dsp/gate.ts, rng.ts  fade gate for disabled generators; mulberry32 + gaussian
src/worklet/processors.ts  AudioWorklet wrapper (loaded via ?worker&url)
src/audio/engine.ts    AudioEngine: build(ctx) works on any BaseAudioContext;
                       start() = live AudioContext, renderOffline() = same graph
                       in an OfflineAudioContext with FX modulation scheduled
                       ahead (setInterval can't drive offline time) and
                       optional scheduled preset switches (ctx.suspend).
                       switchTo(state) = hard switch: duck master, destroy +
                       recreate FX nodes (no old tails), apply, fade in.
                       Routing changes during morphs go behind a short master
                       dip (rerouteSmoothly). applyFxParams() smooths, except
                       right after a rebuild (freshParams)
src/audio/features.ts  analyser → loudness, swell (vs ~4 s average), brightness,
                       low/mid/high bands, onset envelope (adaptive: rise of 20
                       log bands vs mean + 3·dev). Time-based smoothing (dt).
                       OnsetDetector: envelope → discrete hits
src/audio/analyserSim.ts  pure AnalyserNode emulation (Blackman, smoothing, dB →
                       byte) — runs the live feature pipeline on offline audio
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
src/state/share.ts     #s=base64url(JSON) — now only for old links and the
                       offline Share fallback; userPresets.ts → localStorage
                       key synesthesia_user_presets_v1
src/state/canonical.ts canonicalJson (sorted keys) + presetIdOf (SHA-256 →
                       10 base62) — shared with the Worker
src/state/launch.ts    parseLaunch: presetId > #s= > preset > none; cleanUrl
                       keeps settings (res/scout/api), drops the point
src/state/cloud.ts     sharePoint / fetchPoint (injectable fetch, timeout)
src/state/lastPoint.ts synesthesia_last_point_v1 — restored on a plain reload
src/genome/genes.ts    GENES derived from the schemas: cont (normalized 0..1,
                       exp → log scale) / bool / choice, gated by activeIf;
                       MOD_TARGETS; ROUTE_SLOTS = 12
src/genome/codec.ts    AppState ⇄ Genome (masterGain/presetName aren't genes)
src/genome/evolve.ts   pure: mutate (sparse gaussian + momentum + one weighted
                       structural move; never touches inactive genes), repair
                       (1..5 formulas + explicit-coupling floor Σ ≥ 1.2),
                       randomGenome, lerpGenome (discrete genes
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
                       boxCountDimension, analyzeSound, fractalScore),
                       clicks.ts (median-relative HF click detector)
src/coupling.ts        pure: features × card-coupling genes → card param offsets
                       (shift/lightAngle wrap, the rest clamp); COUPLING_LABELS
src/visualFx.ts        pure: explicit couplings (PLAN.md #8) → DisplayFx
                       {exposure, flash, tint[3]}; RippleSet (≤4, 1.6 s).
                       main.ts: OnsetDetector hit → sim.inject() + ripple
src/presets.ts         12 presets = formula-synth sound × chromaflux material,
                       with cross-domain LFO routes and coupling
src/ui/details.ts      read-only "what is this point" panel (+ fractality);
                       renders into #detailsBody — the panel's own ✕ lives
                       outside it, so a re-render can't wipe it
src/ui/wakelock.ts     screen wake lock: taken on the first gesture, re-taken
                       when the tab is visible again (phones dim otherwise)
src/main.ts            wiring only: explorer → 2 s eased genome morph →
                       engines; shared LFO clock (audio.time when sound runs);
                       settle → last point saved + scout scheduled; a step
                       cleans the URL; loads use audio.switchTo; Share → short
                       link (ClipboardItem with a promise, for Safari)
cloud/                 Worker (src/index.ts), D1 migration, Miniflare tests
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
- Never write an oscillator as sin(2π·f·t) with absolute t —
  tests/continuity.test.ts will catch it; accumulate phase.
- Don't let scripts or tests write to the production Worker/D1.
- Never use `window.prompt` / `confirm` / `alert`: mobile browsers may
  suppress them, and a suppressed `prompt()` returns null, so the action
  silently does nothing. Use `src/ui/askDialog.ts` (the smoke fails on any
  native dialog).
- Never let a `localStorage` write fail in silence — the quota is shared by
  every app on the origin. Write through `saveUserPresets`-style helpers
  that read back what they wrote and report `full` / `blocked` to the user.
