# Moving the web app onto the shared core — plan & decisions

*Status: decisions agreed with the user on 2026-10-05; phase 0 built on
branch `core` (2026-10-05); its Android gate failed → C12 (cheaper
generators in the core) done; Android re-measure pending.*

The web app was the first home of Synesthesia and is still the
specification: [synesthesia-core](../synesthesia-core/) dumps its presets,
schema and genes from here (`scripts/dump-*.mjs`) and checks its generators
against takes rendered by the TypeScript (`golden/`). The console
([../synesthesia-rust](../synesthesia-rust/)) and the Android app
([../synesthesia-android](../synesthesia-android/)) run on the core. This
plan moves the web app onto it as well, so that the model exists **once**
and every app — web, console, Android, a later iOS — is *device + screen +
storage* around it.

What exists in the core today (synesthesia-core `4a6f890`): `syn-core` (23
generators bit-exact with the TS, the FX chain, the engine, features and
onsets, the genome, evolve, explorer, scout, the picture's per-frame driver
and quality ladder, the CPU picture, AppState, the schema, the Settings
model, `#s=` tokens and `parse_launch`), `syn-player` (the live render side),
`syn-session` (👍 👎 🎲 ↩, the morph, scout scheduling, status) and `syn-ffi`
(UniFFI → Kotlin/Swift). The core caught up with this repository on
2026-10-04 (tanpura, bowl, shimmer, pink LFO; 15 presets, 250 genes).

## Decisions (agreed with the user, 2026-10-05)

Numbered C1… so other docs can cite them.

C1. **Everything but the platform moves to the core — the sound included.**
    The web app renders sound with the core's engine (generators, FX chain,
    limiter, features, onsets) inside one AudioWorklet; the session, genome,
    explorer, morph, scout, AppState, schema and Settings model come from the
    core too. What stays TypeScript is what is the browser's: Web Audio
    plumbing, WebGL2, the DOM, localStorage, the Worker client, wake lock,
    the iOS unlock, touch.
    - **Accepted consequence: the web app will sound like the console and
      Android, not like it does today.** The core's FX chain is its own DSP
      (FDN reverb instead of the convolver, its own limiter instead of
      `DynamicsCompressor`). Measured by the console port (synesthesia-rust
      PLAN.md decision 3, 12 presets): every preset within ±2.1 dB of the
      browser, reverb tails audibly different. The presets were tuned
      against the browser chain, so a listening pass is part of the swap
      (phase 9).
    - Gain: the scout scores the sound that actually plays (today it scores
      a 24 s @ 8 kHz surrogate of a different chain); one implementation of
      every bug fix.

C2. **The core becomes the specification.** Presets, the schema (ranges,
    defaults, labels), the gene list and the shaders are authored in
    synesthesia-core; the web app reads them through wasm like the other
    apps do. A new preset, generator or LFO shape is made in the core first.
    - `scripts/dump-presets.mjs` and `dump-golden.mjs` are retired; the 69
      golden takes stay **frozen** as regression references (they are what
      "bit-exact with the TS" meant and stay what "unchanged" means). The
      core's rule "never hand-edit `assets/`" becomes "assets/ is the source;
      edit it there, with its tests".
    - Before the TS model is deleted, its behaviour is **frozen into
      fixtures** in the core (phase 1), so the switch of the specification
      loses nothing that was only known to the TypeScript.

C3. **The wasm binding is a new crate in the core: `syn-wasm`**
    (wasm-bindgen), beside `syn-ffi` and with the same rule: thin, converts
    types, no logic. It is checked by the core's `scripts/check.sh` (build
    for `wasm32-unknown-unknown` + its tests). The web app pins a core
    revision and builds the package itself (C9); a change to the core is
    pushed there first and the revision bumped here on purpose — exactly the
    Android workflow (AGENTS.md "Changing the core").
    UniFFI is not used for JS: its wasm/JS support is not mature.

C4. **The scout runs on a pool of plain Web Workers**, one single-threaded
    wasm instance each; `syn-session` keeps deciding *what* to render and
    *when* (as it does for Android, where the app brings the threads), the
    web app only runs the jobs. No `SharedArrayBuffer`, so no COOP/COEP and
    no service-worker hack — GitHub Pages can't send those headers. Pool
    size `max(1, hardwareConcurrency − 2)` (the console's xrun lesson). The
    render length and rate are chosen by measurement in phase 4: the core
    may afford the console's 30 s @ 22 kHz where the browser chain could
    only afford 24 s @ 8 kHz (`analyze.mjs --configs` had found ρ=0.73 for
    the latter).

C5. **The points Worker validates through the core's wasm.** `cloud/`
    stops importing `src/state/schema.ts` and `canonical.ts`; it loads
    `syn-wasm` and calls the core's sanitize, canonical JSON and point id.
    App and server keep accepting exactly the same thing.
    - **Old links must not break**: the core's canonical JSON and id
      (SHA-256 → 10 base62) must reproduce the TypeScript's byte for byte. A
      fixture of real points (a read-only export of production D1, plus the
      presets and random genomes) pins it before the TS is removed.

C6. **Sound measurements move into the core as a Rust CLI.** The metrics
    the web app has and the core lacks — `character.ts` (dropout, swing, low
    end, harmonicity, roughness, motion), `clicks.ts`, `spectrogram.ts`
    (`--png`), the onset and preset-switch benches, `--configs`, `--repeat`,
    `--ref`, `--wav` — are ported into `syn-core/analysis` and a bench
    binary in the core. They become available to the console and Android too,
    and run without a browser. The `sound-check` and `new-preset` skills move
    to the core with them.
    The web app keeps only what measures the platform: `--render` /
    `--render --passes` (WebGL fps), `--picture` (the GPU picture over
    minutes), the smoke and `snap`.

C7. **Rollout: a branch, then one swap.** All work happens on a long-lived
    `core` branch; `main` keeps today's app untouched until the user has
    listened to and looked at the branch on the devices that matter (desktop,
    Android Chrome, iOS Safari), then the branch is merged and the TS model
    disappears in the same merge. There is no `?core=1` dual path in the
    code.
    - Consequence: during the migration `main` does not get model changes
      (new presets, generators, sound tuning). If one is needed, it is made
      in the core and lands with the swap.

C8. **The CPU picture is the fallback for browsers without WebGL2 /
    `EXT_color_buffer_float`**: the core's `Picture` draws into a 2D canvas
    from the main thread's wasm. The GPU path stays the default; the same
    seeded field on both paths is compared in a test (as on Android,
    synesthesia-android decision 4).

C9. **CI builds and deploys GitHub Pages; `docs/` leaves git.** A GitHub
    Actions workflow installs Rust + `wasm-pack`, builds `syn-wasm` at the
    pinned revision, runs the checks, builds the site and publishes it with
    the Pages actions (the Android app's "no build outputs in git" rule).
    Locally `npm run build` does the same (Rust needed on the machine); the
    generated wasm package is never committed.

C10. **Shaders live in the core** (`synesthesia-core/shaders/`), next to the
    driver that sets their uniforms. The web app takes them from the pinned
    revision (shipped inside the `syn-wasm` package); Android's
    `sync-shaders.sh` is pointed at the core instead of this repository.

C11. **`presetName` → `preset_name` is not part of this migration.** The
    point's format does not change here. Once sanitize and serialization are
    shared, the core's TODO item is done as one change in the core for all
    apps (old `#s=` tokens and D1 points keep being read; the id question is
    decided then).

C12. **The core's generators are made cheaper; their golden takes may move
    within −100 dB** (agreed 2026-10-05, after phase 0's gate). On an
    Android phone (Chrome 154, 8 cores) the heaviest preset took 13 % of the
    budget as a batch but ~50 % live (the audio thread runs on a slow core;
    drawing does not change it), and at 3× the work the thread stalled (22
    gaps > 50 ms, up to 176 ms) — ~2× of headroom instead of the gate's 3×.
    A native profile of the heaviest presets: generators 74 % (Shepard's
    per-octave `exp2`/`log2`/`exp` and Additive's 2·N `sin` per sample),
    the FX chain 16 %, the analyser's FFT 8 %. So the generators are
    rewritten for speed (recurrences, analytic logs, no per-octave
    transcendental where an identity gives it), and the golden comparison
    for a rewritten generator is "worst difference ≤ 1e-5" (−100 dBFS)
    instead of 1e-6. Every other generator stays at 1e-6; the takes stay
    frozen. The gate is re-measured on the phone afterwards.
    - **Done (core `2c60f92`):** the looser tolerance was not needed — the
      takes still match to 1.6e-16. Additive by rotating unit vectors (4
      transcendentals per sample instead of 2·N), Shepard by an analytic
      log2 and a recurrent envelope, `hypot` → `sqrt(re²+im²)` in the
      analyser (wasm has no fma; libm's `hypot` emulates one — 20 % of the
      wasm render, invisible in the native profile), and `phase` wrapped at
      1e5 instead of 1e9 (musl's `sin` goes multi-precision past ~1.6e6:
      the wasm render grew 15 % over 20 minutes; now flat for an hour).
      Wasm in node, % of a 48 kHz budget: Fractal garden 7.0 → 3.4, Loom &
      copper 7.1 → 3.0, Overtone steppe 6.1 → 2.2; the heaviest is now
      Tanpura halo, 3.7 → 3.3. Left: FX chain 19 %, `sin` 22 %, FFT 11 %.

Unchanged by all of the above: the `AppState` v1 shape and the gene order;
localStorage keys and formats (`synesthesia_library_v1`, the last point);
`#s=` and `?presetId=` links; the points Worker's API and D1.

## What goes, what stays

| today (TypeScript) | after the swap |
|---|---|
| `src/dsp/*`, `src/worklet/processors.ts` | core engine in one AudioWorklet (`src/worklet/core.ts`) |
| `src/audio/engine.ts` (Web Audio FX graph, offline render) | thin: AudioContext, the worklet node, master gain, `switchTo` → player commands |
| `src/audio/features.ts`, `analyserSim.ts` | feature frames from `syn-player`, posted from the worklet |
| `src/audio/filters.ts`, `modrouting.ts`, `seed.ts` | gone (core) |
| `src/audio/iosUnlock.ts` | stays |
| `src/schema/*`, `src/presets.ts`, `src/fxPresets.ts`, `src/palette.ts` | core (`schema()`, `presets()`, …) |
| `src/genome/*` | `syn-session` + `syn-core::genome`; scout jobs run in `src/scout/pool.ts` workers |
| `src/state/schema.ts`, `canonical.ts`, `share.ts` | core (sanitize, canonical id, tokens) |
| `src/state/launch.ts` | core `parse_launch`; the URL cleaning stays here |
| `src/state/store.ts`, `library.ts`, `migrate.ts`, `lastPoint.ts`, `cloud.ts`, `userPresets.ts` | stay (browser storage + the Worker client) |
| `src/sim/engine.ts`, `src/gl/*` | stay: WebGL2 ping-pong + draw calls, uniforms from the core's frame driver |
| `src/sim/params.ts`, `grid.ts`, `quality.ts`, `src/coupling.ts`, `src/visualFx.ts`, `src/ui/touch.ts` (pure parts) | core (`sim::driver`, `quality`, `coupling`, `display`) |
| `src/sim/shaders/*` | core `shaders/` (C10) |
| `src/ui/settingsModel.ts` | core `settings` (sections, ranges, options); `settings.ts` only renders it |
| `src/ui/*` (DOM), `wakelock.ts`, `askDialog.ts`, `pointList.ts` | stay |
| `src/analysis/*` | core (C6); `picture.ts` stays for `--picture` if the core's version needs the GPU state |
| `src/main.ts` (1 075 lines) | wiring: session effects → player / renderer / storage, as Android's `applyEffects` |
| `cloud/` | stays, validation via `syn-wasm` (C5) |

## Phases

Each phase ends with the core's `scripts/check.sh` green (when the core
changed), `npm run check` + `npm run smoke` green on the branch, and this
table updated.

| phase | | state |
|---|---|---|
| 0 | `syn-wasm` scaffold + the performance gate | built; Android gate failed (~2× headroom) → C12 done (~2.1× cheaper), **Android re-measure pending** |
| 1 | Freeze the TS behaviour into core fixtures; core catches up | — |
| 2 | The core becomes the specification | — |
| 3 | Sound: the core engine in the AudioWorklet | — |
| 4 | Session and scout | — |
| 5 | Picture | — |
| 6 | Settings, details, points, links | — |
| 7 | Points Worker on wasm | — |
| 8 | Tooling, CI, docs | — |
| 9 | Listening pass and the swap | — |
| 10 | After: `preset_name` (C11) | — |

### 0. Scaffold and the performance gate

- `synesthesia-core/syn-wasm`: wasm-bindgen crate; `check.sh` builds it for
  `wasm32-unknown-unknown` (release, `opt-level=3`, `lto`) and runs its
  tests under node.
- A bench page (in this repo, `scripts/analyze.mjs --core-bench` or a
  sibling) that runs `syn-player` in an AudioWorklet and reports, per
  preset, the time to render one 128-frame quantum and the number of
  underruns over 60 s.
- **Gate (measure before building on it):** the heaviest preset must render
  in ≤ 35 % of the quantum's budget on a mid-range Android phone in Chrome
  and on an iPhone in Safari, with no underruns in 60 s while the page
  draws. The browser chain today is ~1.1× realtime on this machine
  (synesthesia-rust PLAN.md "Why native"); the native core is ~20× — wasm
  is expected in between. If the gate fails, stop and decide again with
  the user (SIMD, a smaller FX budget, or C1 reconsidered).
- Settle the worklet mechanics, each with a test:
  - the `WebAssembly.Module` is compiled on the main thread and handed to
    the worklet through `processorOptions` (the worklet scope has no
    `fetch`);
  - the worklet scope lacks `TextDecoder`/`TextEncoder` in some browsers —
    the audio side's exports take and return numbers and typed arrays only
    (a point goes in as UTF-8 bytes decoded on the Rust side), or a tiny
    polyfill is installed; decided by what wasm-bindgen emits;
  - nothing allocates per quantum on the JS side (one preallocated output
    view).
- Bundle size of `syn-wasm` (gzip) written down; it matters for the first
  load on a phone and for the Worker (phase 7).

**Done (2026-10-05).** synesthesia-core `dc1457f` adds `syn-wasm`
(`AudioCore`: the player for one worklet, presets, the version); this
repository pins it in `package.json` (`synesthesiaCore.rev`) and builds it
with `npm run core` (`scripts/build-core.mjs`) into `src/core/pkg/`,
gitignored. The worklet is `src/worklet/core.ts`, its main-thread half
`src/core/audio.ts`, the protocol `src/core/protocol.ts`.

How the mechanics came out (`tests/coreWorklet.test.ts` pins each):
- **The module** is compiled on the main thread and handed over in
  `processorOptions`; where a browser refuses to clone a `Module` (a
  `DataCloneError` from the node's constructor), the bytes go instead and
  the worklet compiles them (`initSync` does). Both paths measured in
  Chromium; Safari's is what the iPhone run will say (the page prints which
  one it took).
- **`TextDecoder`**: wasm-bindgen's glue constructs one when it is
  evaluated, so a scope without it fails at import. Decided: a ~30-line
  UTF-8 decoder (`src/worklet/textPolyfill.ts`) installed only where the
  global is missing, imported before the glue; `AudioCore` itself speaks
  numbers and byte arrays only, so the decoder is reached only by a panic
  message. No `TextEncoder` is needed (points go in as bytes, encoded on the
  main thread).
- **No allocation per quantum**: `render(n)` returns an offset into the
  module's memory and the worklet keeps one `Float32Array` view onto it,
  remade only when the memory grew — which a new point's parse can do once,
  a quantum never does (the test runs 5 000 quanta and counts views).
- **Load is timed with `Date.now()`** inside the worklet: Chromium's
  worklet scope has neither `performance` nor `TextDecoder` (probed). The
  first bench assumed its 1 ms steps fall at random phases of a 2.7 ms
  quantum, so a live sum would be unbiased. **It is not reliable**: on the
  Mac the same preset reads 6 % as a batch and while drawing, but 22–25 %
  live with nothing drawn (an idle CPU wakes the audio thread on a slow
  core and/or in step with the millisecond); the Android phone read 13 % as
  a batch and 44 % live while drawing, with no underrun. So live
  percentages are reported, not gated. What the gate reads instead:
  - batches (hundreds of ms each, immune to the step), idle **and** while
    the picture draws;
  - a **stress phase**: ballast players of the heaviest preset render
    beside the live one (`ballast` command), 3× the work ≈ 35 % of the
    budget, for 30 s while drawing, and the underruns are counted
    (Chrome's `AudioContext.playbackStats`). Checked that it can fail: on
    the Mac 12× gave 5 underruns, 30× 1 794 and kept up only 52 %.
    Safari has no underrun counter; there only a sustained overload shows
    (`keptUp` < 99 %), and gaps > 50 ms between quanta.
- **Size**: `syn_wasm_bg.wasm` 650 KB, **187 KB gzip** (the whole model is
  linked: presets, schema, genome). The worklet bundle is 5 KB.

The gate's bench is `core-bench.html` (`npm run bench:core` headless;
`npm run bench:serve` serves it over self-signed HTTPS to a phone on the
LAN). Results, worklet thread, 48 kHz:

| device | browser | heaviest (batch, idle / drawing) | live idle / drawing | underruns live / at 3× | verdict |
|---|---|---|---|---|---|
| MacBook (M-series, 10 cores) | headless Chromium, SwiftShader picture 30 fps at rung 2 | Fractal garden 6.3 % / 6.3 % (16× realtime); lightest 1.1 % | 22.6 % / 6.2 % | 0 / 0 | pass |
| Android 10, 8 cores (first bench, no stress phase) | Chrome 154, picture 60 fps at rung 2 (577×1080, grid 205×384) | Loom & copper 13.0 % (7.7×); lightest 2.1 % | — / 43.7 % | 0 / — | 44 % > 35 % by the old reading; rerun |
| Android 10, 8 cores | Chrome 154, picture 60 fps at rung 2 | Fractal garden 12.9 % / 13.1 % (7.8×); lightest 2.1 % | 51.3 % / 48.3 % | 0 / 0 by Chrome's counter, but 22 gaps > 50 ms (max 176 ms) at 3× | **fail** → C12 |
| MacBook, after C12 | headless Chromium | Tanpura halo 3.0 % / 3.1 % | 9.8 % / 1.9 % | 0 / 0 | pass |
| Android, after C12 | Chrome | | | | pending |
| iPhone | Safari | | | | not available to the user |

`-C target-feature=+simd128` was tried: the same within ±3 % (node, all 15
presets, twice) — the DSP is per-sample and scalar, there is nothing for
the auto-vectorizer. Not a lever.

The production bundle (`vite build`) measures the same (6.4 % / 6.2 %).

### 1. Freeze the TS behaviour; the core catches up

Everything the TypeScript knows that the core does not yet pin, captured
**while the TS still exists**, as fixtures committed to the core:

- **Sanitize/clamp**: a corpus of inputs (presets, random genomes, mutated
  and broken JSON, old `#s=` tokens, points from the D1 export) → the TS's
  `sanitizeState` + `stateToAppState` output. The core must produce the
  same JSON (values to ~9 significant digits, AGENTS.md pitfall).
- **Canonical JSON and the point id** (C5): the same corpus → canonical
  string and id. Add `canonical_json` + `point_id` (SHA-256 → base62) to the
  core; bit-identical.
- **Genome codec and evolve**: already pinned (250 genes to 1.1e-16; host
  tests of the explorer) — extend with the TS's `diffSummary` strings if the
  web keeps showing them.
- **fxPresets.ts** (one-module effect presets in ⚙ Settings) → core.
- **Analysis** (C6): `character`, `clicks`, `spectrogram` ported, each
  checked against the TS on identical samples (the console did this for the
  fractality score: agreement to 0.000).
- **Onsets**: `tests/onsets.test.ts`'s behaviour thresholds ("a bell every
  4 s → 3–6 hits in 16 s") re-stated as core tests.
- **Shaders** moved to `synesthesia-core/shaders/` (C10), with a check that
  they are identical to this repository's until the swap.

### 2. The core becomes the specification (C2)

- `assets/presets.json`, `schema.json`, `genomes.json` become hand-edited
  sources in the core, guarded by its tests (every preset survives
  sanitize+clamp unchanged, ≥ 1 visual route or coupling — today's
  `tests/presets.test.ts` rules move there).
- Retire `dump-presets.mjs` / `dump-golden.mjs`; golden takes frozen.
- Update the core's README / AGENTS.md ("the web app stays the
  specification" → the core is), and synesthesia-android's PLAN.md
  "Keeping up with the web app" (the direction reverses).
- Android: `sync-shaders.sh` reads from the core.

### 3. Sound (branch `core`)

- `src/worklet/core.ts`: one processor hosting `syn-player`; commands
  (`SwitchTo`, `PlayState`, master gain, fades) arrive over the port;
  feature frames (loudness, swell, brightness, bands, onset, hits,
  spectrum) go back over the port at frame rate, stamped on the played
  clock.
- `src/audio/engine.ts` shrinks to: AudioContext, the node, the iOS unlock
  (still started synchronously in the Sound click — AGENTS.md), suspend /
  resume, master gain.
- The LFO clock is the audio clock (one clock, as before): the main thread
  reads it from the frames.
- Checks: the smoke's sound assertions; preset switches without clicks
  (the core's `--switch` bench); the continuity test lives in the core.

### 4. Session and scout

- `main.ts` drives `syn-session`: a press, a load, settings open/close and
  the 25 ms tick go in; effects come out and one `applyEffects` gives them
  meaning in the browser (play state → worklet, reseed → picture, save last
  point → localStorage, status → DOM, start scout → the pool).
- `src/scout/pool.ts`: the Web Worker pool (C4); a job is the session's
  scout request, its result goes back through `scout_finished`. Stale
  versions are dropped by the session, as today.
- Measure: candidates ready per press, and the scout's cost to the audio
  (underruns while it runs) on the phone from phase 0. Choose the render
  length/rate here and write the number into this file.

### 5. Picture

- `src/sim/engine.ts` keeps WebGL2 and the passes; the per-frame inputs
  (cards through LFOs and couplings, display effects, ripples, onset and
  touch stamps) come from the core's frame driver; shaders from the package.
- The quality ladder and boot probe from the core (`sim::quality`).
- CPU fallback (C8) into a 2D canvas; a test compares the same seeded field
  on GPU and CPU.
- Measure: `--render` fps before/after on this machine, interleaved
  (AGENTS.md), must not regress.

### 6. Settings, details, points, links

- ⚙ Settings renders the core's settings model; `tests/settings.test.ts`'s
  round-trip guarantee moves to the core.
- Details panel, the point's name, the status line from the session's view.
- `parse_launch` from the core; `presetId` fetch, URL cleaning, library,
  last point, migration stay here unchanged.

### 7. Points Worker on wasm (C5)

- `cloud/` loads `syn-wasm` (a Worker size limit check: if the full package
  is too large, a `state`-only build feature of `syn-wasm`).
- Miniflare tests: the fixture of real points gets the same ids as before.
- Deploy only after the swap (phase 9), by the user's go.

### 8. Tooling, CI, docs

- `scripts/analyze.mjs` keeps `--render`, `--render --passes`, `--picture`;
  everything else points to the core's bench (C6).
- CI workflow (C9): Rust + wasm-pack, `npm run check`, smoke, build, deploy
  to Pages; `docs/` removed from git and from AGENTS.md.
- AGENTS.md module map, README, PLAN.md "Architecture", the `verify` skill
  rewritten; `sound-check` and `new-preset` move to the core.

### 9. Listening pass and the swap

- The user listens to all 15 presets on the branch (desktop, Android
  Chrome, iOS Safari) next to today's `main`, and looks at the picture.
  Presets that lost what made them liked are retuned **in the core** (the
  `new-preset` routine, now in the core) — this also retunes them for
  Android and the console.
- Then: merge, delete the TS model, deploy the Worker, bump nothing else.

### 10. After the swap: `preset_name` (C11)

The core's TODO item, done once in the core.

## Open questions (to decide when the phase comes)

- How the user previews the `core` branch on a phone before the swap
  (C7): GitHub Pages serves one site. Options: a CI artifact served
  locally, or a separate preview host — decide in phase 8, before phase 9.
- The scout's render configuration (phase 4, by measurement).
- Whether `src/analysis/picture.ts` moves to the core or stays (phase 1:
  depends on whether it needs the GPU's state).
