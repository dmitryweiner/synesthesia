# Synesthesia

Sound and image generated together from one point in a large parameter
space, and steered by you. Press 👍 when you like where it's going, 👎 when
you don't, and the search follows.

**Live:** GitHub Pages build in [`docs/`](docs/).

## How it works

- **One point, two senses.** A point is a *genome* of ~500 genes: which
  sound formulas are on and their parameters (21 generators from
  [formula-synth](../formula-synth/): additive, FM, Lorenz/Rössler chaos,
  logistic map, Shepard tone, Risset bell, noises, …), the FX chain
  (filter, chorus/flanger, phaser, delay, reverb, limiter), the image
  simulation (Gray–Scott reaction-diffusion with spatial feed/kill
  variation and curl-noise flow, from [chromaflux](../chromaflux/)), its
  palette, a pool of 4 slow LFOs with up to 12 routes, and 5 audio→image
  coupling weights.
- **Shared modulation.** An LFO route can target a synth parameter, an FX
  parameter or an image parameter. The built-in presets use this: in
  *Fractal garden* the same 77-second triangle sweeps the logistic map
  through its bifurcation cascade and sweeps the reaction's Feed across
  the Pearson map, so spots→coral→maze in the picture coincide with the
  period-doubling in the sound.
- **Live coupling.** Loudness, spectral brightness and onsets of the sound
  push flow, gloss, hue and the light angle of the picture every frame.
  How strongly is part of the genome, so it evolves too.
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
- **Keep it / share it.** 💾 Save stores the point in your browser, 🔗 Share
  copies a link. The URL always carries the current point (`#s=…`).

Keys: ← 👎 · → 👍 · ↑ 🎲 · Backspace ↩ · Space ▶ sound.

URL parameters: `?preset=N` opens built-in preset N, `?res=N` sets the
simulation grid (default 1024, 512 on small screens), `?scout=0` turns
the scout off.

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

```bash
node scripts/analyze.mjs --random 12              # presets vs random points
node scripts/analyze.mjs --preset 0 --mutants 8   # what 👍/👎 would propose
node scripts/analyze.mjs --mutants 5 --configs 30@22050,8@16000
                                                  # how well a short render predicts a long one
node scripts/analyze.mjs --preset 0 --wav shots/wav
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
