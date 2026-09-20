---
name: sound-check
description: Measure Synesthesia's actual sound instead of guessing — fractality of a point, onset hits (does the picture react to bells/drops?), clicks at preset switches, phase continuity under modulation — and tune thresholds on real renders. Use when changing src/dsp, src/audio, presets, coupling or the scout, or when the user reports beating, clicks, silence or "the picture doesn't react".
---

# Measure the sound

There are no speakers here, and stills show nothing about sound. Every knob
in this project was set from one of these numbers.

## Tools

```bash
npm run analyze                       # fractality of every preset (30 s renders)
npm run analyze -- --onsets           # onset hits per preset at 60/30/15 fps
npm run analyze -- --switch 0,3,10 --at 12   # clicks around preset switches
npm run analyze -- --configs 30@22050,24@8000  # does a cheap render rank like a long one?
npm run analyze -- --preset 0 --mutants 8      # what 👍/👎 would propose, scored
npm run analyze -- --random 12                 # presets vs random points
npm run analyze -- --preset 0 --wav shots/wav  # WAVs to listen to / re-analyze
npx vitest run tests/continuity.test.ts tests/onsets.test.ts
```

`analyze.mjs` renders the **real graph** (worklet generators + FX + LFOs)
through an `OfflineAudioContext` in headless Chromium, so what it measures is
what users hear. It needs the Vite dev server (it imports `/src/*.ts`).

## What the numbers mean

| number | healthy | meaning |
|---|---|---|
| `score` (fractality) | presets 0.6–1.0; random points 0.55±0.31 | 1/f-ness of loudness and timbre + spectrogram structure |
| `envβ` / `cenβ` | ≈1 (pink) | β of the 1/f^β fit; 0 = restless, 2 = static; `—` = contour too flat to fit |
| `box` | ~1.5–1.7 | box-counting dimension of the loudest spectrogram cells |
| onset hits / 20 s | struck: ~1 per attack (bells 10, drops 14); drones ≤2 | each hit seeds growth + a ripple in the picture |
| hits at 15 fps | within ~2× of 60 fps | weak devices must still see the attacks |
| swell range | ±0.3…0.9 on drones | drives the exposure pulse |
| clicks at a switch | 0 | `analyze.mjs --switch`; attacks inside struck presets are *not* faults |
| roughness ratio (continuity test) | < 1.3 | modulated vs unmodulated HF energy; >2 means phase jumps |

## Tuning a threshold (the method that worked)

1. Render the real audio once: `npm run analyze -- --wav shots/wav --secs 20 --sr 24000`.
2. Write the expectation as behaviour in `tests/onsets.test.ts`
   ("a bell every ~4 s → 3–6 hits in 16 s", "drones ≤ 4").
3. Compare candidate settings over **all** presets and at 60/30/15 fps —
   `--onsets` prints exactly that table. Never tune on one preset.
4. Keep the bench in `scripts/analyze.mjs` behind a flag, not in a scratch file.
5. Dry generator audio is stricter than the app: FX smooth attacks and pads
   flicker. Check both (unit tests = dry, `--onsets` = full graph).

## Frequent causes of complaints

- **"Harsh beating", worse the longer it plays** → an oscillator computing
  `sin(2π·f·t)` from absolute time; any frequency change jumps the phase by
  2π·Δf·t. Accumulate phase (`tests/continuity.test.ts` guards this).
- **Clicks when switching points** → FX topology changed with signal in the
  chain, or an old delay/reverb tail warping. Hard switches go through
  `AudioEngine.switchTo()` (duck → rebuild FX → apply → fade in).
- **"The picture doesn't react"** → check onset hits first (detector), then
  the coupling genes (`Details` panel shows them), then the exposure range
  via `body[data-fx-exposure]` in the live app.
- **A proposal went silent** → the scout penalizes candidates >6 dB quieter;
  check `adjustedScore` and the `dB` column in `analyze.mjs`.
