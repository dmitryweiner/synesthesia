# Synesthesia

Sound and image generated together from one point in a large parameter
space, and steered by you. Press 👍 when you like where it's going, 👎 when
you don't, and the search follows.

**Live:** GitHub Pages build in [`docs/`](docs/).

## How it works

- **One point, two senses.** A point is a *genome* of ~500 genes: which
  sound formulas are on and their parameters (21 generators from
  [formula-synth](../formula-synth/): additive, FM, Lorenz/Rössler chaos,
  logistic map, Shepard tone, Risset bell, noises, …, plus a tanpura:
  four plucked strings with the jawari buzz, and a singing bowl whose
  inharmonic modes beat slowly), the FX chain (filter,
  chorus/flanger, phaser, delay with an octave-up shimmer, reverb,
  limiter), the image
  simulation (Gray–Scott reaction-diffusion with spatial feed/kill
  variation and curl-noise flow, from [chromaflux](../chromaflux/)), its
  palette, a pool of 4 slow LFOs (sine, triangle, saw, square, S&H, or
  pink: 1/f wandering) with up to 12 routes, and 5 audio→image coupling
  weights. Routes aimed at one parameter add up.
- **Shared modulation.** An LFO route can target a synth parameter, an FX
  parameter or an image parameter. The built-in presets use this: in
  *Fractal garden* the same 77-second triangle sweeps the logistic map
  through its bifurcation cascade and sweeps the reaction's Feed across
  the Pearson map, so spots→coral→maze in the picture coincide with the
  period-doubling in the sound.
- **The picture listens.** In the same frame the sound happens:
  loudness *swells* breathe the exposure, every hit (a bell strike, a
  drop) flashes the highlights and sprouts new growth in the pattern with a
  ripple spreading from it, and bass / mid / treble tint the dark / mid /
  light tones. Slower links nudge the simulation too (loudness → flow and
  gloss, brightness → hue, onsets → light angle). How strongly each link
  acts is part of the genome, so it evolves too — with a floor, so the link
  never fades away.
- **Directed search.**
  - 👍 **More of this** — the current point becomes the anchor; the next
    proposal continues along the step that led here, with a smaller spread.
  - 👎 **Not this** — back to the last liked point, a step in a different
    direction (the rejected step's dimensions are avoided), larger spread.
  - 🎲 **Surprise** — jump near a random built-in preset.
  - ↩ **Undo** — the last 5 changes.
  - Every change morphs smoothly over ~2 s.
- **Fractality-guided proposals ("scout").** People tend to like sound
  whose fluctuations look alike across time scales (1/f, "pink"
  fluctuations of loudness and pitch). While the sound plays, the app
  renders the current point and 3 👍 + 3 👎 candidates offline through the
  same audio graph, measures how fractal each is and, when you press,
  picks the best one. Candidates that got much quieter are penalized.
  Renders are 24 s at 8 kHz: about as cheap as 8 s at 16 kHz, but they rank
  candidates much closer to a full 30 s / 22 kHz render (Spearman ρ 0.73
  vs 0.23). Disable with `?scout=0`.
- **Keep it / share it.** 💾 Save stores the point in a tiny cloud
  database and keeps its name and id in this browser; it then sits under
  *My points* in the points list, with a 🗑 on its row (that removes it
  from your list — links you shared keep working). 🔗 Share stores the
  point the same way and copies a short link
  (`…/synesthesia/?presetId=cnG1Iacvvb`) — the same point always gets the
  same link. Saving and opening a saved point need the network, and the
  status line says so when it isn't there. The current point survives a
  reload on its own, and old long `#s=…` links still open.

**Touch or drag the picture** and it answers the way it answers the music:
new growth under your finger and a ripple spreading out from it — the same
reaction an onset in the sound produces.

Keys: ← 👎 · → 👍 · ↑ 🎲 · Backspace ↩ · Space ▶ sound.

How big it renders is **measured, not guessed**: the first frames of the
real loop walk up a quality ladder (`src/sim/quality.ts`) and stop at the
richest grid + canvas the machine holds at ~20 fps. That is decided once, at
startup, and never moves afterwards, so the picture cannot degrade while you
are watching it. You may see it sharpen over the first half-second.

URL parameters: `?presetId=<id>` opens a shared point, `?preset=N` opens
built-in preset N, `?res=N` sets the simulation grid, `?scale=N` caps the
longest side of the canvas backing store in device pixels (`0` = no cap),
`?scout=0` turns the scout off. Either `?res=` or `?scale=` switches the
startup measurement off, so a link — or a script — renders exactly what it
asks for. (`?api=http://localhost:…` points Share at a local Worker —
development only.)

## Development

```bash
npm install
npm run dev            # Vite on :5173
npm run check          # tsc --noEmit && eslint . && vitest run
npm run build          # type-check + build into ./docs (GitHub Pages)
npm run smoke          # Playwright browser smoke (WebGL2 + Web Audio)
npm run snap -- --out shots/x.png [--preset N] [--sound] [--like N] [--details]
npm run analyze        # fractality of every preset's actual sound
```

`npm run smoke` and friends need a Playwright Chromium
(`npx playwright install --with-deps chromium`), or set `CHROMIUM_PATH`.
The smoke also runs the points Worker locally, so do `npm install` in
`cloud/` once.

### Short links (Cloudflare)

`cloud/` is a Cloudflare Worker + D1 database (same setup as
`../monitoring`), deployed at
https://synesthesia-presets.dmitry-weiner.workers.dev:

| route | |
|---|---|
| `POST /v1/points` | body = a point (≤ 16 KB) → `{ id }` (201 new, 200 already stored) |
| `GET /v1/points/:id` | the point; immutable, cached for a year |
| `GET /v1/health` | `{ ok: true }` |

The Worker validates points with the app's own `sanitizeState` /
`stateToAppState` (bundled from `src/`) and derives the id from the
canonical JSON (`src/state/canonical.ts`): first 10 base62 characters of
its SHA-256. Limits: 20 saves / min and 300 reads / min per IP, 5 000 new
points a day, 500 000 in total.

```bash
npm run check:cloud    # worker type-check + Miniflare tests
npm run deploy:cloud   # apply D1 migrations + wrangler deploy
```

### Sound analysis

`scripts/analyze.mjs` renders points through the app's real audio graph
(worklet generators + FX + LFOs) in an `OfflineAudioContext` inside headless
Chromium and reports, per point:

| column | meaning |
|---|---|
| `envβ` | β of the 1/f^β spectrum of the loudness contour (pink = 1, white = 0, brown = 2) |
| `cenβ` | same for the spectral-centroid (timbre/pitch) contour |
| `HFD` | Higuchi fractal dimension of the loudness contour |
| `box` | box-counting dimension of the spectrogram's loudest cells |
| `score` | the above folded into 0..1 (`src/analysis/fractal.ts`) |

With `--character` (`src/analysis/character.ts`) it also says what *kind*
of sound it is:

| column | meaning |
|---|---|
| `drop` | how deep the sound falls out: median minus 5th percentile of 400 ms loudness, dB |
| `swing` | how far it breathes: 95th minus 5th percentile, dB |
| `low` | share of energy below 200 Hz (weight) |
| `harm` | share of spectral-peak energy on one harmonic grid |
| `rough` | Plomp–Levelt roughness of the peaks (level-independent) |
| `mot1` / `mot10` | how much the spectrum changes over 1 s / 10 s, dB |

```bash
node scripts/analyze.mjs --random 12              # presets vs random points
node scripts/analyze.mjs --preset 0 --mutants 8   # what 👍/👎 would propose
node scripts/analyze.mjs --mutants 5 --configs 30@22050,8@16000
                                                  # how well a short render predicts a long one
node scripts/analyze.mjs --preset 0 --wav shots/wav
node scripts/analyze.mjs --switch 0,3,10,7 --at 12  # clicks at preset switches
node scripts/analyze.mjs --onsets                  # onset hits per preset at 60/30/15 fps
node scripts/analyze.mjs --preset 12 --repeat 4     # mean ± sd over 4 seeded reverb rooms (a render repeats exactly)
node scripts/analyze.mjs --preset 12 --secs 60 --png shots/png
                                                  # a log-frequency waterfall + loudness picture per render
node scripts/analyze.mjs --picture --preset 13,14  # the PICTURE in numbers: coverage, edges, change over 5 min
node scripts/analyze.mjs --character --ref 0,3,5,6,8
                                                  # + character columns, and every point's distance
                                                  #   to a reference group of presets
node scripts/analyze.mjs --render                  # frames per second, per grid × canvas
node scripts/analyze.mjs --render --passes         # ms per pass (fields / react / display)
```

First results: built-in presets score 0.79 ± 0.14 against 0.55 ± 0.31 for
random points, and *Fractal garden* (tuned by ear for waterfall fractality
in formula-synth) scores highest at 0.97.

## Stack

TypeScript, Vite, vitest, ESLint (no `as` casts), Playwright. No UI
framework and no runtime dependencies: Web Audio `AudioWorklet` for sound,
raw WebGL2 for the image.

## License

GPL-3.0, see [LICENSE](LICENSE).
