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

## "Points still don't save on mobile Chrome" (2026-09-21)

Reported with screenshots from Android Chrome: the app's own *Name this
point* prompt appeared, the point never showed up in the list, and nothing
said why. Not reproducible under mobile emulation, so the two ways a phone
can refuse a save were both removed instead of guessing:

- **Native dialogs are gone.** `window.prompt` / `window.confirm` can be
  suppressed on mobile — after a few dialogs Chrome for Android offers
  "prevent this page from creating more dialogs", and from then on `prompt()`
  returns `null` with nothing shown, which our code read as "user
  cancelled": Save silently did nothing. Saving, deleting and the
  copy-link fallback now use the app's own dialog (`src/ui/askDialog.ts`),
  which also fits a phone screen (the native one covers it). The smoke test
  fails if any native dialog is ever opened.
- **A refused write is now reported.** `saveUserPresets` returns
  `{ ok: false, reason: 'full' | 'blocked' }` instead of throwing, and
  verifies by reading back what it wrote (a blocked or private-mode store
  can accept a write that vanishes). The status line then says the storage
  is full (delete a point or use 🔗 Share) or that the browser isn't storing
  site data — and the list shows what is really stored, never a phantom
  entry. **The localStorage quota is shared by the whole origin**, so every
  app on `dmitryweiner.github.io` (formula-synth, chromaflux, monitoring, …)
  eats into the same budget.
- **Saving merges with what's on disk.** It re-reads localStorage
  immediately before writing, so a second tab (the report came from a phone
  with 9 tabs open) can't drop points saved in the first; a `storage` event
  refreshes the list in the other tabs.
- **The build stamp is visible** in *Details* (`__BUILD__`, injected by
  `vite.config.ts`). The screenshots showed a pre-fix build running in a
  long-open tab, which cost most of the diagnosis; now a screenshot says
  which build it is.

## Decisions after user testing (agreed with the user, 2026-09-21)

10. **Saved points live in the points database; the browser keeps only
    names and ids.** Proposed by the user after hitting "storage is full"
    on a phone. 💾 Save now POSTs the point exactly like 🔗 Share does
    (content-addressed, anonymous, immutable) and stores
    `[{ id, name }]` under `synesthesia_library_v1` — **37 bytes** against
    the **4.4 KB** a whole point took, on a quota that is shared by every
    app on the origin. Consequences, all accepted deliberately:
    - Opening one of your points needs the network; the status line says so
      when it isn't there. Saving does too: no network, no save — and it
      says that instead of pretending.
    - Points saved by older builds are uploaded on the first boot that can
      reach the server, then the old key is dropped — which is also what
      frees a full quota. Anything that fails to upload stays put and is
      retried next time; nothing is ever deleted before its replacement is
      stored (`src/state/migrate.ts`, `tests/migrate.test.ts`).
    - If even the short list can't be written, the point is still on the
      server, so the status line hands over its link.
    - 🗑 removes a point from *your list*; the point itself stays in the
      database, so links you shared keep working.
    - Rejected: a panel showing what fills the origin's quota (the other
      apps on dmitryweiner.github.io). The message is enough now that our
      own footprint is ~37 bytes per point.
11. **The points list is the app's own panel, not a `<select>`.** A phone
    renders `<select>` options as a system sheet, which cannot hold a 🗑
    next to a row — deleting a point was nowhere near the list of points.
    The panel (`src/ui/pointList.ts`) shows *My points* with a 🗑 on each
    row, then the built-ins, and the toolbar button shows what is playing.

## Decisions after profiling on a GPU-less machine (agreed with the user, 2026-09-22)

12. **How big to render is measured at boot, not guessed.** Reported from an
    Orange Pi 4 Pro (Allwinner A733, 1080p, Debian 13): `/dev/dri` has only
    the display controller — no render node, no GPU driver — so every pass is
    rasterized on the CPU. The app ran the default point at **0.4 fps** in a
    maximized window, because `simResolution()` decided from
    `min(innerWidth, innerHeight) < 700` and a 1080p board passes that test.
    - *Measured first, and it contradicted the guess.* A hand-written C cost
      model had said the noise fields were ~60% of the frame. On the real
      rasterizer (`analyze.mjs --render --passes`, new) the frame at
      res 1024 / 1920×1080 is **react ×16 = 1406 ms (80%), display = 238 ms
      (13%), the two noise fields = 120 ms (7%)**: the reaction dominates,
      and the C model missed it because react.frag's cost is texture
      sampling, not arithmetic. With the grid made negligible, the canvas
      alone costs 262 ms at 1920×1031 against 128 ms at 1280×671 and 46 ms at
      640×271 — `display.frag` is the one pass that never shrank with
      `?res=`.
    - *A ladder of rungs, walked upwards.* `src/sim/quality.ts` pairs a
      canvas cap with a grid: `640/192 → 840/256 → 1080/384 → 1280/512 →
      1600/768 → uncapped/1024` (~2× of work per step). The first frames of
      the real loop render at each rung and keep the richest one whose median
      frame is ≤ 50 ms (20 fps — the 15 fps floor minus what the audio thread
      and the scout will take). It walks *up* so the worst case is one frame
      of the rung above the machine's ceiling, not one frame at full quality
      (2.6 s here); the picture sharpens over the first half-second.
    - *Once, at boot — no live governor.* Chosen deliberately: a rolling
      step-down would change the picture under a viewer mid-listen. A resize
      re-applies the same rung, it does not re-probe.
    - *`?scale=N`* caps the longest side of the canvas backing store in
      device pixels (`0` = no cap); the CSS size stays 100%, so the upscale
      is a blit. Either `?res=` or `?scale=` switches the probe off, so
      scripts and links stay deterministic — which is also why the smoke has
      one page with neither, to exercise the probe at all.
    - *`speed` is never capped automatically.* It is the number of reaction
      substeps per frame, so cutting it halves how fast the pattern evolves
      per second of wall clock and `uDt` cannot compensate (the scheme is at
      its stability limit). Grid and canvas come down instead.
    - *Result on the reported machine* (1920×1080, default point, headless
      software rasterizer, before → after): **0.57 fps → 10.8 fps**, of which
      2.0× comes from the passes themselves (below) and the rest from
      choosing a rung the machine can hold. In a 1280×720 window it reaches
      12.5 fps and at 640×360, 15.8. The ≥15 fps the backlog asked for is
      therefore met below 720p and not at full 1080p: there the canvas alone
      (backing store plus the compositor's upscale) is ~46 ms of the 93 ms
      frame, and no further rung would buy much.
13. **The noise fields render at half the grid's side.** `paramfield` and
    `velocity` are 4-octave fbm and a curl field — smooth by construction,
    and both are read by UV with LINEAR filtering — so a quarter of the cells
    costs a quarter of the ten fbm evaluations per cell for detail that is
    not there. Verified by eye on *Fractal garden* and on *Bell spots* (the
    finest noise scale in the built-ins): same pattern family, same blob
    size, no aliasing or moiré. Rejected alongside it: recomputing the fields
    only every N frames. It would have saved little once they were at half
    resolution, and the presets' LFO routes into `flow` would have made the
    drift visibly step.

    The engine also stopped paying for passes that change nothing (an off
    Field variation card now binds a 1×1 zero texture instead of running
    `paramfield`; advection with no amount or a zero velocity is an identity
    copy and is skipped with its velocity pass), and reuses either field
    while its inputs are unchanged. Those are exact no-ops, not trade-offs.

    Two more changes with no visual consequence at all carried most of the
    per-pass win: the simulation targets are **RG16F, not RGBA16F** (every
    one of them holds two channels; the other two were dead bandwidth), and
    **react.frag reads with `texelFetch`, not `texture`** — its 9-point
    stencil lands exactly on texel centres, so the bilinear filter had
    nothing to interpolate, and hand-clamped integer coordinates give the
    same zero-flux boundary `CLAMP_TO_EDGE` did. Measured per pass at
    res 1024 / 1920×1080, before → after: **react 87.9 → 36.2 ms a substep,
    the noise fields 120 → 42 ms, display 238 → 205 ms.**

## Decisions after user testing (agreed with the user, 2026-09-23)

14. **The picture answers a finger.** Users asked for a touch/click reaction
    like ../chromaflux's. This partly revises decision 2 ("Brush is not
    ported — no pointer tool in this app"): the *tool* still isn't ported,
    because there is no parameter UI here to hold its five modes and two
    sliders. What is ported is the reaction.
    - A press drops fresh "ink" into the reaction and sends a ripple out from
      it — the **same `inject()` disc and the same ripple an onset hit
      already produces** (decision 8). A finger and a bell strike are the
      same kind of event, so they get the same two passes: no new gene, no
      new shader, no new card.
    - Dragging paints continuously. The stroke is sampled **once per frame**,
      not per `pointermove` (which fires at up to 120 Hz and each stamp is a
      full-grid pass), and the gap between two frames is filled in with
      evenly spaced stamps — at 10 fps on a machine with no GPU a finger
      crosses a third of the screen between frames, and stamping only the
      current position leaves a dotted trail instead of a stroke
      (`strokePoints`, `src/ui/touch.ts`).
    - *The strength is fixed, not the point's `onsetToSeed` gene.* People
      asked for a reaction; a point that happens to have evolved a weak onset
      coupling must not read as a broken app.
    - `touch-action: none` on the canvas, and the pointer is captured, so a
      drag is a stroke rather than a scroll or a text selection, and it keeps
      painting at the edge if the finger leaves the canvas.

## Bugs found after user testing (2026-09-23)

- **iOS: sometimes no sound at all — fixed.** The hardware Ring/Silent
  switch mutes Web Audio, because the audio session sits on the "ringer"
  category by default. ../formula-synth already had the fix and this app had
  never got it: playing a short **silent `<audio>` element inside the user
  gesture** moves the session to the media category
  (`src/audio/iosUnlock.ts`, ported; the WAV bytes are written inline rather
  than pulling in an encoder). Two things make or break it, and both are
  guarded:
  - it must start **synchronously in the click, before the first `await`**,
    or iOS does not count it as an activation — so it is the first statement
    of `startAudio()`, and the smoke fails if `body[data-ios-unlock]` is not
    `1` once sound is running;
  - it must **keep looping** while the engine plays, or iOS puts the session
    back on the ringer channel.
- **iOS: silence after a call or an app switch — fixed.** The context is
  suspended when the tab goes away and does not always come back on its own:
  the button still said it was playing and nothing was heard.
  `visibilitychange` now resumes it, the same way ../formula-synth does.
  (`AudioEngine.resume()` already existed here — nothing had ever called it.)

## Bugs found after user testing (2026-09-26)

- **Phones dimmed again after a lock/unlock — fixed.** Reported: the
  "keep the screen on" stopped working once the phone had been locked and
  unlocked, and only a page reload brought it back. Two holes in
  `src/ui/wakelock.ts`: (1) the browser marks the old lock `released` at
  once but may fire its `release` event *after* the page is visible
  again. The code trusted the event, still "held" the dead lock at that
  moment, skipped the request and never retried. (2) A request refused
  right after unlocking was swallowed, and the only gesture listener had
  already fired once. Now `sentinel.released` decides, a late event from an
  old lock can't clear a newer one, and every touch/key, `focus` and
  `pageshow` retries whenever no lock is held (`tests/wakelock.test.ts`
  replays the lock/unlock sequences).

## Decisions after user listening (agreed with the user, 2026-09-26)

15. **Overtone steppe stays, with a rounder bass.** A 13th preset built on
    the profile of the presets people liked most (formula-synth's FX-mod
    family): one 55 Hz harmonic grid, a band that never breaks, and a
    peaking resonance narrow enough (Q 30, +20 dB) to whistle a melody out
    of the drone's own overtones. The user's verdict: the top and the
    high-frequency resonance "5+", the bottom "a bit too rough — make it
    more melodic and fat". Measured with the same reverb rooms (three
    seeds) so that variants compare as pairs, not through room noise:
    - the roughness was the sawtooth's own low harmonics, not the tanh
      growl — removing the growl changed nothing below 400 Hz;
    - what cures it is a strong smooth fundamental under them: the growl
      became a warm, nearly pure 55 Hz sine (tanh at α 0.9, gain 0.28, no
      stepped drive), and the beating pair breathes slower and louder
      (0.25 Hz, gain 0.38; S&H now varies its pace instead of the drive);
    - result: roughness below 400 Hz −30%, the fundamental 0.97 of the
      bass (was 0.86–0.90), low-mid grit −6.5 dB, the band above 600 Hz
      unchanged to 0.0 dB (correlation 1.00), fractality 0.89 → 0.96. The
      price: +6 dB RMS, all of it bass (−26 dB, inside the presets' −24…−35).
      A gentler middle step was rendered for comparison
      (`shots/overtone-steppe-bass/`, local only).
16. **No server outlives its script** (the user's rule). Scripts start a
    fresh Vite server for their own checkout on a free port and kill its
    process group on any exit; a server started by hand is stopped before
    the session ends. Reusing whatever answered on a port had measured a
    stale snapshot's code (AGENTS.md, test-harness pitfalls).
17. **PLAN-IMPROVEMENTS.md waits for the next session** — proposals only,
    nothing from it is implemented yet.

## Decisions on PLAN-IMPROVEMENTS.md (agreed with the user, 2026-09-26)

Went through the proposals one by one. **Taken up:** A1, A2, A4, A5, B1,
B2, B8, B9 (below). **Deferred**, they stay in PLAN-IMPROVEMENTS.md: A3
harmonic snap, A6 a non-repeating `additive`, A7 stereo, B3 long-form
check, B4 LUFS leveling, B5 before/after diff, B6 character-aware scout,
B7 real preferences. **Rejected:** A8.

18. **A pink (1/f) LFO shape, and a new preset built on it.** A sixth
    shape, `pink`: five octaves of smooth value noise at `rate·2^j`, equal
    amplitude per octave (Voss–McCartney), cosine-interpolated so it glides,
    hashed from the LFO phase like S&H so sound and picture stay in sync.
    Appended after the existing shapes, so stored choice indices keep their
    meaning. The prototype raised fractality where a sound was too smooth
    (*Fractal garden* 0.84 → 0.96, *Aurora* 0.74 → 0.94, *Molten Polivoks*
    0.53 → 0.66) and hurt where it was already restless (*Whale coral*
    0.63 → 0.41: its pitch drift became jitter). So it is **an extra shape,
    not a replacement: no existing preset changes.** Instead a new preset is
    built around it once the shape exists. The prototype's hard clamp
    (`sum/5·2.2`) is replaced by a soft limit.
19. **Routes aimed at one parameter add up.** The offsets sum in each
    route's own space (octaves for `exp`, linear otherwise) and the result is
    clamped once; today the last route silently wins. No preset targets a
    parameter twice, so no built-in sound changes. *Overtone steppe* is
    **not** given a glide-plus-leaps whistle: its top was rated "5+", and
    without A3's harmonic snap the leaps of a Q 30 filter would often land
    between harmonics, where the whistle vanishes.
20. **Tanpura and shimmer, and a second new preset.** The tanpura is a new
    formula: four Karplus–Strong strings on the grid (Pa–Sa–Sa–Sa: 3/2, 2,
    2, 1) plucked in a slow cycle, with the *jawari* buzz that blooms after
    each pluck. It's a drone with gentle, regular attacks, so the picture
    pulses with the plucks (drones fire 1–2 onset hits per 30 s today;
    target 4–8, dropout still ≤ 6 dB). Shimmer is **a delay parameter**
    (`delayShimmer`, 0..1): an octave-up pitch shifter inside the echo loop.
    At 0 it is the plain echo, so every existing point sounds exactly as
    before. It gets a limiter inside the loop and a test that the peak
    stays bounded over 5 minutes. The preset "tanpura + shimmer" is
    **separate from the pink-LFO preset**: two new presets, one idea each
    (the new-preset skill's rule). The tanpura preset may still use pink
    LFOs where they help.
21. **The reverb room comes from a fixed seed, everywhere.** The impulse
    is seeded noise in the app and in the analysis, so the room depends
    only on the reverb parameters: a point sounds the same on every device
    and through every link, and A/B renders compare in the same room (a
    random room moved *Overtone steppe*'s score across 0.82–0.96). The
    analysis can average over several seeded rooms. Rejected: a seed per
    point (every 👍 would rebuild the impulse) and seeding only the
    analysis. With seeded renders, the open "two whole runs at 0.70" issue
    (PLAN-IMPROVEMENTS B1) is rerun: it either reproduces, and is a real
    render bug to find, or it doesn't.
22. **Analysis tools: a spectrogram PNG, picture metrics, `?paused=1`.**
    `analyze.mjs --png` writes a log-frequency waterfall and the loudness
    curve for every render, so an agent can *see* what it can't hear.
    Picture metrics (coverage, edge density, frame-to-frame change over
    minutes) are **a tool that prints numbers per preset**. Whether any of
    them becomes a guarding test is decided later, from real numbers.
    `?paused=1` stops the app's frame loop for analysis, which frees the ~2
    cores the GPU process takes, so renders can run in parallel.
23. **A8 "tides" is rejected.** Decision 1 stands: nothing moves the point
    without user input. Slow LFOs (down to 0.003 Hz, a ~5.5-minute lap)
    already let single parameters go somewhere and come back while the
    point stays put.
24. **B7 (logging real 👍/👎 and listening time) is deferred.** It needs a
    consent line, a storage design, and enough users for the data to mean
    anything.

### How #18–22 came out (2026-09-26)

- *Pink LFO:* measured 1/f (−3 dB per octave) from rate/2 to 4·rate,
  steeper above, where the top octave's smoothing takes over; a tanh soft
  limit keeps the prototype's spread (sd 0.4–0.6) with round peaks.
- *Adding routes* also fixed a real bug: the worklet saved and restored
  each route's param in turn, so a param with two routes had an effective
  value written back as its base on every block, and it drifted.
- *Shimmer* sits in the loop delay → feedback gain → shimmer → delay. The
  shifter's two sin²/cos² grains are a convex mix of past input, so the
  loop stays bounded by its feedback alone; a low-pass before the shifter
  makes each pass die out as it climbs. Measured: bounded over 5 minutes
  at feedback 0.9 with no build-up. At 0, the nine delay presets render
  bit-identical (4) or within 1 LSB of 16 bit (5) to the old wiring.
- *Seeded renders* cover the noise formulas too (rain, ocean, velvet, …),
  not only the room, so a noise preset repeats as well. Six whole runs of
  *Overtone steppe* (60 s, seeds 1–4) gave identical per-seed scores,
  0.97 / 0.95 / 0.84 / 0.98. **The "0.70 ± 0.00" runs did not recur**; if
  a seed's score ever differs between runs, that is now a detectable
  render bug. The room itself still moves a score by up to 0.14.
- *`--png`* immediately showed something no metric had flagged: every
  render starts with ~6 s of broadband reverb tail from the generators
  switching on. Harmless, but the first seconds are not the sound.
- *`?paused=1`:* while an analysis renders, Chromium takes ~1.0 core
  instead of ~6.8, and a 60 s render finishes in 17.5 s instead of 20 s.
  The user added (2026-09-26) that the app runs on other machines, so
  render speed *on this dev box* is not worth optimizing further.
- *Picture metrics* (`analyze.mjs --picture`): coverage, edges and change
  of the simulation's V channel, read back through `?probe=1`. Over 2
  minutes, *Overtone steppe*, *Whale coral* and both new presets all grew
  (the tanpura's cells 0.16 → 0.41 coverage) and kept changing.
- *The tanpura* came out differently from the proposal in two places:
  - the jawari is a contact pulse per string (a smoothed step at the top
    of each swing, scaled by the swing, blooming in ~120 ms after a
    pluck). The textbook model — shortening the loop with the
    displacement — measured *darker*, not brighter;
  - the pluck is three periods of two-pole low-passed noise, a finger
    rather than a pick. A one-period burst was a full-band hit on every
    pluck.
- **Two presets, waiting for the user's ears** (WAV pairs in
  `shots/candle-glaze/`, `shots/tanpura-halo/`):
  - *Candle glaze* (13): all four LFOs pink; a resonant low-pass "flame"
    over a 49 Hz grid, a 0.34 Hz pink flicker on the FM lace, Glaze worms
    drifting up. Fractality 0.87 ± 0.08 against 0.84 on sine LFOs;
    distance 0.94 to the liked family.
  - *Tanpura halo* (14): tanpura on a 65 Hz Sa with a round sine under it
    and shimmer; dividing Verdigris cells seeded by the plucks. Distance
    0.91; shimmer adds +4 dB at 4–8 kHz and +12.5 dB above 8 kHz and
    leaves everything below 2 kHz alone. **Onsets: 20–23 per 30 s, not
    the 4–8 the plan aimed at**: the detector hears nearly every pluck and
    some echoes, so the picture seeds on each pluck (the flash is turned
    down to 0.25 for that). Fractality 0.67, because the fat bass smooths
    the loudness contour (0.87 with a thinner bass) — bass kept.

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
