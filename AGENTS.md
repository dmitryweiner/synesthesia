# AGENTS.md — project map and working rules

(Claude Code reads CLAUDE.md, which points here; keep everything in this
one file so the two never drift apart.)

Synesthesia: one point in a ~500-gene space generates sound (formula
generators + FX, ported from [../formula-synth](../formula-synth/)) and an
image (Gray–Scott reaction-diffusion, ported from
[../chromaflux](../chromaflux/)) at the same time; the user steers the
search with 👍/👎. **The model is the shared Rust core**
([../synesthesia-core](../synesthesia-core/), as wasm): the point, the
sound, the analysis, the genome and the search, the picture's decisions,
the presets, the settings' data. This repo is the web shell around it —
the page, WebGL drawing, Web Audio plumbing, storage, the points Worker.
A change to how anything *sounds, evolves or is valued* is made in the
core and arrives here by bumping the pin (PLAN-CORE.md C2). Decisions agreed with the user live in **PLAN.md** — read
it before changing behavior. Proposals that are *not* agreed yet (sound
mechanics, missing measurements, with the numbers behind them) live in
**PLAN-IMPROVEMENTS.md**. The move onto the core is recorded in
**PLAN-CORE.md** (decisions C1–C13, the measurements behind them). README.md is the human-facing spec. UI, docs
and code comments are in English.

## Commands

```bash
npm run check     # tsc --noEmit && eslint . && vitest run — after every change
npm run core      # build syn-wasm at the rev pinned in
                  # package.json into src/core/pkg/ (never committed); check/dev/
                  # build/smoke run it first. Rust + wasm32 target + wasm-pack.
                  # SYN_CORE_DIR=../synesthesia-core builds a working tree instead
npm run bench:core  # phase 0 gate: each preset's share of the audio budget in the
                  # worklet, then the heaviest live while the picture draws
npm run bench:serve # HTTPS dev server on the LAN: open /core-bench.html on a phone
                  # (self-signed: accept the warning). Stop it when done
npm run smoke     # Playwright: boot, sound, 👍/👎/🎲/undo, every preset,
                  # ?preset=N, save+reload, share link in a 2nd tab, scout,
                  # ⚙ Settings (picture paused, sound heard, one undo step).
                  # The ONLY check of WebGL2/Web Audio (vitest can't load them)
npm run snap -- --out shots/x.png [--preset N] [--sound] [--like N] [--dislike N]
                  [--details] [--help] [--res N] [--wait ms]
                  [--settings audio|video] [--scroll px]  # ⚙ Settings, pane scrolled
                  [--reseed] [--stroke x0,y0,x1,y1]  # drag on a clean field:
                  #   the only way to see what a touch actually painted
npm run analyze -- --render [--grid 1024,256] [--scale 0,1280] [--size WxH]
                  #   FPS of the real rAF loop per configuration (--grid 0 =
                  #   let the boot probe choose, and see what it chose);
                  # --render --passes: ms per PASS — a 1-px readPixels is a
                  #   real barrier where gl.finish() is not, and timing step()
                  #   at 1 vs 11 substeps splits one react substep from the rest;
                  # --picture [--minutes 5 --every 30]: numbers for the
                  #   PICTURE per preset (coverage, edges, change; flags a
                  #   pattern that died or froze), read from the sim state.
                  # The SOUND is measured by synesthesia-core's syn-bench
                  #   (fractality, --onsets, --switch, --configs, --repeat,
                  #   --character/--ref, --wav, --png): PLAN-CORE.md C6
npm run build     # core + tsc + vite build into ./dist; CI (.github/workflows/pages.yml)
                  # builds and publishes it to GitHub Pages — nothing built is committed
npm run check:cloud   # cloud/ Worker: tsc + Miniflare tests (npm install in cloud/ once)
npm run deploy:cloud  # D1 migrations --remote + wrangler deploy (wrangler is authorized)
```

TDD: tests first, then code. Commits are allowed at milestone granularity
(brief). Reuse/extend `scripts/*.mjs` instead of writing one-off scripts.
**Leave no server running** (the user's rule): scripts start and stop their
own; a server you start by hand (`npm run dev`, a snapshot's vite), you stop
before the session ends — `pgrep -af '[b]in/vite'` must print nothing.
Agreed decisions go into PLAN.md (numbered, dated) — the user asks for that.

The **`verify`** skill carries the routine here (which checks to run before
a commit and how to read their failures). Measuring the sound
(**`sound-check`**) and making or retuning a preset (**`new-preset`**) are
synesthesia-core's skills now — the sound and the presets live there
(PLAN-CORE.md C2, C6).

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
| why 0.57 fps on a 1080p board with no GPU? | `analyze.mjs --render --passes` | react×16 = 1406 ms of 1764 (80%), *not* the noise fields (120 ms, 7%) — a C cost model had said the opposite |
| how much does the canvas cost on its own? | `--render --grid 64` (grid made negligible) | 262 ms at 1920×1031, 128 at 1280×671, 46 at 640×271 — it does not shrink with `?res=` |
| is a 0.1 score difference between two points real? | `analyze.mjs --repeat 4` | the room moves the score: liked presets ±0.01–0.03, a point with envβ≈2 (the steep side of the preference) read 0.28 and 0.52. Rooms are seeded now (PLAN.md #21): *Overtone steppe* 0.97 / 0.95 / 0.84 / 0.98 on seeds 1–4, identical in six whole runs — the old "two runs at 0.70±0.00" never recurred |
| does shimmer change points that don't use it? | `--wav` of the 9 delay presets, shimmer node in the loop vs the old wiring | 4 bit-identical, 5 within 1 LSB of 16 bit (≤ −96 dBFS) |
| what does the analysis page's own frame loop cost? | Chromium %CPU while rendering, `?paused=1` vs not | ~1.0 core vs ~6.8 cores; a 60 s render 17.5 s vs 20 s wall |
| what do the presets people liked most have in common? | `analyze.mjs --character --ref 0,3,5,6,8` | a band that never breaks (dropout 4–6 dB vs 8–12 for drips/bells/wind), low end 0.65–0.96 of the energy (vs 0.0–0.2), one harmonic grid, slow change |
| did the render changes actually help? | `--render` / `--render --passes`, base vs new snapshots, interleaved | same configuration 2.0×; default point 0.57 → 10.8 fps |

(The sound rows were measured on the old TypeScript model with
`analyze.mjs`; the same questions are now answered by the core's
`syn-bench` and tests — see its `sound-check` skill.)

Corollaries:
- A metric that runs as a unit test beats one that needs a browser: the
  core's tests run the live feature pipeline on rendered audio.
- Keep the bench: put it behind a flag (`syn-bench` for sound,
  `scripts/analyze.mjs` for the page's rendering and picture), not in a
  throwaway script — the next tuning session starts from numbers, not zero.
- State thresholds as behaviour ("a bell every 4 s → 3–6 hits in 16 s"), so
  a future change that breaks the *feel* fails a test.

## Test-harness pitfalls that already cost time

- **Render whole blocks.** `SR * seconds` is usually not a multiple of 128;
  a truncated last block drops samples between two `fill()` runs and fakes a
  discontinuity (a "click" that isn't there).
- **The click detector can't tell a pluck from a click.** It is
  median-relative: a plucked string over a dark sustain, or the jawari's
  buzz blooming after a pluck, reads as a burst of "clicks". Look at the
  `--png` waterfall instead: a real discontinuity is a full-band line that
  reaches below the lowest fundamental.
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
  always-visible button squeezes the name to an unreadable stub — measure
  `#pointsBtn` width at 390 px after touching the toolbar, and remember
  `#topbar > button:not(#audioBtn)` outweighs a plain `#id` rule.
- **Timing the frame loop needs a real barrier, and `gl.finish()` is not
  one.** GL commands are queued to the GPU process, so counting rAF
  callbacks measures how fast frames are *enqueued*: the identical
  configuration read as 0.3 fps or 2.9 fps depending on how deep the queue
  had grown, and `gl.finish()` returned without the raster having happened.
  A 1-pixel `gl.readPixels` does block (it has to hand back real pixels) —
  that is what `--render`, `--render --passes` and `SimEngine.syncFrame()`
  all use, and with it the same configuration repeats to ±2%.
- **Throw away the first render in a fresh browser.** SwiftShader JIT-compiles
  the shaders in the GPU process, which outlives the tab, so the first page
  measures ~8× slower than every later one at the identical configuration
  (0.29 fps, then 2.73, 2.36, 2.53). No warm-up *inside* the page covers it;
  `--render` opens and closes a throwaway page first.
- **`analyze.mjs`'s page is the live app**, and its rAF loop keeps painting
  while audio renders offline: at the default canvas the GPU process took
  ~2.5 cores and a 60 s render went from ~20 s to 60–190 s. It opens with
  `?res=64&scale=64` — keep both if you change that URL.
- **Long analysis runs die when you edit `src/`** (Vite full-reloads the
  page). Run them from a snapshot instead:
  `rsync -a --exclude node_modules --exclude docs --exclude shots --exclude .git ./ $SNAP/`,
  symlink `node_modules`, then `node scripts/analyze.mjs …` from `$SNAP` —
  the script starts its own server there, on a free port.
- **Scripts never reuse a server.** `startServer()` (lib.mjs) starts a fresh
  one for its own checkout on a free port and kills its process group on
  any exit (normal, crash, Ctrl-C). Reusing whatever answered on :5173 is
  how a stale snapshot server from an earlier session (it held :5181 for
  days) got measured instead of the code at hand; killing only `npx` left
  `vite` running after every run.

## Headless browser gotchas (this machine: aarch64, SwiftShader)

- WebGL runs in software: 1–5 fps at 1024², cold first load ~17 s. Scripts
  pass `?res=128` (smoke default) — a big grid starves the CPU enough for a
  second tab's `goto` to time out. `?res=`/`?scale=` also switch the boot
  probe off, so a script gets the configuration it asked for.
- **Another session on this machine invalidates every fps number.** The
  benches here are CPU-bound; a parallel `parity.mjs`/`cargo` run pushed the
  same configuration from 180 ms to 696 ms a frame. Check `/proc/loadavg`
  before trusting a number, and measure before/after **interleaved** (two
  snapshots on two ports, alternating) rather than one after the other.
- Never sleep for boot: `openApp()` in scripts/lib.mjs waits for
  `body[data-ready="1"]` (set at the end of `boot()` in main.ts). Fixed
  800 ms sleeps raced the help dialog, which opened after the click.
- Editing anything under `src/` or `index.html` makes Vite full-reload open
  pages — a running `analyze.mjs` dies with "Execution context was
  destroyed". Don't edit sources while it runs.
- `page.reload()` kills the AudioContext: re-start sound before checking it.
- ~5 fps headless means most onsets fall between frames: live probes
  undercount hits. The truth is the core's `syn-core/tests/onsets.rs` and
  `syn-bench --onsets` (the worklet posts every hit; the page reads them
  with `hitHeard()`).
- localStorage is shared by all tabs of a context: the last point written by
  one tab is what another tab's reload restores.

## Cloud — short share links (PLAN.md #9)

- Worker `synesthesia-presets` → https://synesthesia-presets.dmitry-weiner.workers.dev,
  D1 `synesthesia-presets` (id 0a0f3551-69bb-4b0c-8e7f-7efe516a9535),
  rate-limit namespaces 2001/2002, same account as ../monitoring. Resources
  exist and the migration is applied — never recreate them.
- `cloud/src/index.ts` validates and ids points with the core's wasm
  (`sanitizePoint`, `pointId`; `npm run build` in cloud/ copies
  `syn_wasm_bg.wasm` from src/core/pkg): one validation and one id function
  for the apps and the server. A pin bump that changes sanitization changes
  what the Worker accepts — `npm run deploy:cloud` after such a bump.
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
src/core/              the core's wasm (syn-wasm), typed for the page:
  pkg/                 built by `npm run core` at the pinned rev, never committed
  point.ts             sanitize (a point from outside made safe), the
                       built-in presets, isPointId
  session.ts           the core's syn-session on the main thread: 👍/👎/🎲/
                       undo, morphs, the scout's bookkeeping — effects +
                       view as typed JSON; parseLaunch, encodeToken
  settings.ts          ⚙ Settings' data and rules (C13): the page model,
                       the schema's formulas/cards, FX presets, route rules,
                       samePoint
  picture.ts           WebPicture: each frame's uniforms as JSON, seed spots,
                       touches, the quality ladder + boot probe, the CPU
                       picture's frames, pictureMetrics (analyze --picture)
  audio.ts, protocol.ts  compile the module, start the worklet node;
                       main ↔ worklet messages
src/worklet/core.ts    the AudioWorklet hosting syn-player: renders into a
                       view onto wasm memory (no per-quantum allocation),
                       posts feature frames + onset hits. textPolyfill.ts:
                       the worklet scope has no TextDecoder/TextEncoder
src/audio/coreEngine.ts  the live sound: points in as JSON (applyState =
                       glide, switchTo = fade out → switch → fade in);
                       coreFrames.ts picks the frame being HEARD
                       (getOutputTimestamp); features(), hitHeard()
src/audio/iosUnlock.ts the iOS Ring/Silent fix (PLAN.md bugs, 2026-09-23):
                       a silent looping <audio>, started SYNCHRONOUSLY in the
                       Sound click before any await — move that call after an
                       await and iOS goes quiet again
src/scout/             pool.ts: the scout's Web Worker pool (cores − 2,
                       staggered start, cancel); worker.ts runs the core's
                       scoutScore on one genome
src/sim/engine.ts      SimEngine (WebGL2): draws what WebPicture decides,
                       with the core's shaders (C10). Skips passes that
                       change nothing, reuses paramfield/velocity, renders
                       both at half the grid's side
src/sim/cpuRenderer.ts the C8 fallback (no WebGL2 float targets, or ?cpu=1)
src/gl/                context, ping-pong targets, full-screen quad
src/state/types.ts     AppState and friends — types only, no logic
src/state/store.ts     localStorage with read-back: {ok} | {full|blocked}
src/state/library.ts   "My points" = [{id, name}] (synesthesia_library_v1);
                       the point itself lives in the points database
src/state/migrate.ts   old whole-point key → library, losing nothing
src/state/userPresets.ts  the old whole-point key (read for migration)
src/state/launch.ts    cleanUrl keeps settings (res/scout/api), drops the
                       point; withPresetId
src/state/cloud.ts     sharePoint / fetchPoint (injectable fetch, timeout)
src/state/lastPoint.ts synesthesia_last_point_v1 — restored on a plain reload
src/ui/details.ts      read-only "what is this point" panel; renders into
                       #detailsBody — the panel's own ✕ lives outside it
src/ui/settings.ts     ⚙ Settings (PLAN.md #28): full-screen page, tabs Audio
                       / Video. Edits a copy of the point that is main.ts's
                       `state` while open; onSound → engine push (throttled);
                       the frame loop exits while it is open (body[data-loop]);
                       close → one undo step in the session
src/ui/settingsModel.ts  slider scales (log/linear) + the core's data/rules
src/ui/controls.ts, modPanel.ts, adjust.ts  the page's widgets: card, slider
                       row (−/+ auto-repeat), select row; LFO pool + routes
src/ui/pointList.ts    the points panel (a <select> can't hold a per-row 🗑)
src/ui/askDialog.ts    prompt/confirm — never the native ones (suppressible)
src/ui/touch.ts        pure: pointer → canvas UV (Y flips) and the stamps to
                       fill a drag between two frames (PLAN.md #14)
src/ui/wakelock.ts     ScreenAwake: wake lock taken on the first gesture, re-taken
                       on visible/focus/pageshow/any touch; `sentinel.released`
                       decides, never the (late) release event
src/bench/coreBench.ts core-bench.html: the phase 0 gate on a real device
src/main.ts            wiring only: session effects → engine/picture/storage/
                       scout; the rAF loop feeds WebPicture the heard
                       features; a step cleans the URL; Share → short link
                       (ClipboardItem with a promise, for Safari)
cloud/                 Worker (src/index.ts, core wasm), D1 migration,
                       Miniflare tests
tests/                 vitest: the shell's own logic; setup.ts instantiates
                       the core's wasm, points.ts makes points with it
scripts/build-core.mjs clone the pinned core into .core/<rev>, wasm-pack it
                       into src/core/pkg (+ shaders, fixtures)
scripts/lib.mjs        startServer (fresh, free port, killed on exit),
                       startPointsWorker, launchBrowser (CHROMIUM_PATH,
                       autoplay, SwiftShader), openApp (readiness), withRes
scripts/smoke.mjs      invariants only, never pixels; --mobile, --res, --screenshot
scripts/snap.mjs       one debug screenshot
scripts/analyze.mjs    --render [--passes] (fps / ms per pass), --picture
                       (coverage/edges/change from the core's pictureMetrics)
scripts/core-bench.mjs the phase 0 gate headless (npm run bench:core)
```

## Sound analysis — what the numbers mean

(The bench that prints these is synesthesia-core's `syn-bench`, and its
`sound-check` skill holds the current table; the history below is how the
numbers were found, on the browser's graph.)

`envβ`/`cenβ`: β of 1/f^β fitted on 0.05–5 Hz fluctuations of the loudness
(dB) / spectral-centroid (octaves) contours; contours flatter than 0.5 dB /
0.02 oct are "static" (NaN — a steady tone must not score). `box`: box-count
dimension of the loudest 20% of a 64-band log-frequency spectrogram.
`score` = (2·pref(envβ≈1) + 2·pref(cenβ≈1) + pref(box≈1.6)) / 5.

In the browser the score was one room's (a seeded convolver impulse); the
core's FDN reverb has no seeded room, so `--repeat` varies only the noise
generators. `--character` says what kind of sound it is
(`syn-core/src/analysis/character.rs`):
`drop` (median − p5 of 400 ms loudness, dB — does the band break?), `swing`
(p95 − p5), `low` (energy share < 200 Hz), `harm` (peak energy on one
harmonic grid), `rough` (Plomp–Levelt, level-independent), `mot1`/`mot10`
(RMS dB change of the spectrum over 1 s / 10 s). `--ref 0,3,5,6,8` prints
each point's RMS z-distance to that group — the five presets from
formula-synth's FX-mod family, the ones people liked most — and names the
metrics more than 2 sd away.

## Don'ts

- Don't add runtime dependencies or a UI framework.
- Don't re-grow a model here: sound, genome, presets, sanitization, the
  picture's decisions and the settings' data belong to the core. Change it
  there (its own tests and skills), push, bump `synesthesiaCore.rev`.
- Don't hand-edit src/core/pkg/ — it is rebuilt from the pin.
- Don't let scripts or tests write to the production Worker/D1.
- Never use `window.prompt` / `confirm` / `alert`: mobile browsers may
  suppress them, and a suppressed `prompt()` returns null, so the action
  silently does nothing. Use `src/ui/askDialog.ts` (the smoke fails on any
  native dialog).
- Never let a `localStorage` write fail in silence — the quota is shared by
  every app on the origin (all of dmitryweiner.github.io). Write through
  `state/store.ts`, which reads back what it wrote and reports
  `full` / `blocked`, and keep what is stored small: points live in the
  points database, the browser keeps `{ id, name }` (PLAN.md decision 10).
- Don't put app state in a `<select>` that needs per-row controls: a phone
  renders it as a system sheet. The points list is `src/ui/pointList.ts`.
