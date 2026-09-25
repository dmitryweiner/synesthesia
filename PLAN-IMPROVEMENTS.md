# PLAN-IMPROVEMENTS — proposals, not decisions

Ideas collected while building *Overtone steppe* (2026-09-25): new sound
mechanics in the style the project already has (drone / ambient), and the
measurements we are missing. **Nothing here is agreed.** An item that gets
agreed moves to PLAN.md "Decisions" with a number and a date.

Each item says what it is, why (with a number where one was measured), what
it costs, what could go wrong, and how we would know it worked.

## The profile the proposals aim at

The presets people liked most are formula-synth's FX-mod family (here:
*Fractal garden*, *Molten Polivoks*, *Silver maze*, *Space breccia*,
*Loom & copper*). `analyze.mjs --character --ref 0,3,5,6,8`, 60 s renders,
mean of 3:

| | fractality | dropout dB | swing dB | low < 200 Hz | harmonicity | roughness | change 1 s → 10 s |
|---|---|---|---|---|---|---|---|
| liked family | 0.49–0.99 | 3.8–5.8 | 9–18 | 0.71–0.95 | 0.52–0.89 | 0.09–0.25 | 4.5–5.8 → 7–11 |
| drips / wind / bells | 0.52–0.68 | 7.9–12.7 | 16–18 | 0.00–0.21 | 0.35–0.80 | 0.05–0.56 | 5–8 → 7–19 |
| *Overtone steppe* | ~0.9 | 5.6 | 11 | 0.90 | 0.96 | 0.08 | 5.0 → 7.3 |

In words: a band that never breaks, weight in the bass, one harmonic grid,
slow change, and **nothing that repeats** (every family preset runs its
LFOs at mutually irrational rates). Fractality alone does not describe it:
*Molten Polivoks* was liked at 0.49.

---

## A. Sound generation

Ordered by value for effort.

### A1. A pink (1/f) LFO shape — *prototyped and measured*

A sixth LFO shape whose fluctuations are 1/f by construction: 5 octaves of
smooth value noise at `rate·2^j`, equal amplitude per octave
(Voss–McCartney), cosine-interpolated so it glides. Like S&H it is a pure
function of the LFO phase (hashed), so sound and picture, which share the
LFO clock, stay in sync.

Why: people like 1/f fluctuations (Voss & Clarke), and the fractality score
rewards exactly that. Today 1/f has to *emerge* from sums of sines and from
chaotic formulas. Measured on a prototype (every sine/triangle LFO of a
preset replaced by pink at the same rate, same run, 2 renders each):

| preset | sine/triangle | pink | envβ | cenβ |
|---|---|---|---|---|
| Fractal garden | 0.84 | **0.96** | 1.43 → 0.90 | 1.16 → 0.85 |
| Aurora | 0.74 | **0.94** | 0.92 → 0.77 | 1.69 → 1.11 |
| Molten Polivoks | 0.53 | **0.66** | 1.56 → 0.98 | 1.69 → 1.77 |
| Space breccia | 0.65 | 0.71 | 0.88 → 0.73 | 1.94 → 1.66 |
| Overtone steppe | 0.71 | 0.83 | 1.58 → 1.42 | 1.33 → 1.20 |
| Loom & copper | 0.86 | 0.87 | | |
| Silver maze | 0.98 | 0.98 | | |
| Whale coral | 0.63 | **0.41** | 0.46 → 0.23 | 1.49 → 1.83 |

Pink helps where a sound is too smooth (β 1.4–1.9) and hurts where it is
already restless (*Whale coral*: its pitch drift becomes jitter). So it
should be **an extra shape, not a replacement**: evolution and the scout
will pick it where it fits.

Cost: small. `mod.ts` (≈20 lines), the worklet's and schema's shape sets,
and `LFO_SHAPES` in genes.ts. Append the shape at the end so existing choice
indices stay the same. Share links store AppState, so they survive.
Risk: the prototype normalizes with a clamp (`sum/5·2.2`), which flattens
rare peaks. Replace that with a soft limit before shipping.

### A2. Routes on the same parameter add up — *found in code*

`effectiveParams` (src/dsp/mod.ts) recomputes each route from the *base*,
so when two routes aim at one parameter the last one silently wins. Adding
the offsets (in the route's own space: octaves for `exp`, linear otherwise)
and clamping once would make a slow contour **plus** S&H jumps possible:
exactly what *Overtone steppe*'s whistle wanted (a glide that sometimes
leaps to another overtone, and never repeats).

Changes no existing sound: no preset targets a parameter twice (0 of 13),
nor did any point after 260 👍/👎 steps. Random points do in 4 of 200,
and there one route is dead today. Cost: a few lines plus tests (mod.test,
modrouting for FX).

### A3. "Stay on the grid": harmonic snap for pitch

A route flag (and/or a mutation rule) that snaps an `exp` frequency to the
nearest harmonic of the point's fundamental, with the existing FX smoothing
as a glide. Why: the family keeps every voice on one grid (harmonicity
0.5–0.9, against 0.35 for the noise/drip presets). Today a pitch LFO or a
mutation of `fm.fc` / `quasi.fq` / `logistic.base` drifts off it, and
inharmonic partials rub against a drone. formula-synth's *Silver lace*
comment records trying a Risset bell for that reason and dropping it. For
the whistle, S&H would jump exactly from overtone to overtone.
Measure: `harm` and `rough` of 👍/👎 proposals before and after.

### A4. Tanpura: a drone that breathes in plucks

A generator of four Karplus–Strong strings on the grid (Pa–Sa–Sa–Sa:
3/2, 2, 2, 1), plucked in a slow cycle, with *jawari*: the soft nonlinear
bridge buzz that blooms after each pluck. Why: drones fire 1–2 onset hits
per 30 s (`--onsets`: family 1–2, *Overtone steppe* 1–2), so the picture's
seeds and ripples (PLAN #8) almost never happen on the presets people like
most. A tanpura *is* a drone with gentle, regular attacks, so the picture
would pulse with the plucks and the sound would stay continuous.
`karplus` already exists; the new parts are the cycle and the buzz.
Target: 4–8 hits / 30 s, dropout still ≤ 6 dB.

### A5. Shimmer: an octave-up echo

A +12-semitone pitch shifter (two overlapping grain windows) in the delay's
feedback loop: each echo rises an octave and blooms into a halo above the
drone. It is the signature ambient sound (Eno/Lanois) and fits every
family preset. Cost: a worklet FX stage inside the delay loop. Risk: CPU and
runaway build-up. It needs a limiter inside the loop, and a test that the
peak stays bounded over 5 minutes.

### A6. A drone whose inner life never repeats

`additive`'s partial amplitudes are one travelling wave,
aₖ = sin(φ + k)/k, so the whole inner pattern repeats **exactly** every
1/`move` seconds (20 s at *Overtone steppe*'s 0.05 Hz). A variant, a new
formula or a `spread` parameter, would give each partial its own slow drift
(incommensurate rates like `move·√k`, or A1's pink per partial) plus a tiny
per-partial detune (±0.1–0.3 Hz), so the partials beat slowly like a choir.
That matches what the family is built on (LFOs at unrelated rates), applied
to the drone's core. Measure with B3.

### A7. Stereo for headphones

The generators are mono (`outputChannelCount: [1]`); only the reverb tail
is stereo. The cheapest big win for ambient on headphones: `beats` as
**binaural** (f left, f + Δf right, so the 0.5 Hz beat happens inside the
head), and a slow autopan of the ornament voices. Risk: phones often play
mono; check mono compatibility (L+R must not cancel).

### A8. Tides: a slow return trip *(conflicts with PLAN #1)*

A macro morph over 3–8 minutes between the point and one nearby mutant, so
the sound goes somewhere and comes back: form, not just texture. PLAN
decision 1 says nothing changes without user input, so this could only be
an explicit per-point switch. Your call.

---

## B. Evaluation: what we're missing

### B1. Deterministic renders (seeded reverb) — *measured, and one open issue*

The reverb impulse is `Math.random()` noise, built fresh for every render,
and it moves the score. *Overtone steppe* over 14 renders with
different seeded rooms: **0.82–0.96**. A point sitting on the steep side
of the preference curve moved 0.28 ↔ 0.52. Seeding the impulse from the
point (or a fixed seed offline) makes a render repeatable to ±1 LSB
(checked: −90 dB difference between two runs). Then A/B comparisons become
paired (same room), and the scout's ranking stops depending on the room.

**Open issue:** two whole runs rendered *Overtone steppe* at 0.70 ± 0.00
(dropout 7–8.6 dB), while every other run gave 0.83–0.96. It isn't the
code (identical modules served), the server, CPU load (0.91 under 8 busy
processes) or a lost reverb (reverb off gives 0.87). With seeded renders a
rerun either reproduces it, and then it's a real render bug to find, or it
doesn't. Until then: compare points only within one run.

### B2. A spectrogram picture per render (`--png`)

A log-frequency waterfall PNG (plus the loudness curve) for every rendered
point. formula-synth's presets were tuned by looking at the waterfall, and
an agent can read images: it would **see** what it can't hear. This
session spent about an hour building, and then debunking, a numeric
"whistle lead" metric that one picture (a bright line stepping across the
harmonics) would have settled. Cheap: a canvas in the page and `toDataURL`.

### B3. Long-form check (`--long 600`)

A 10-minute render with a novelty curve and "most similar earlier moment"
(self-similarity of the band spectrum). Does it repeat? Does it die out?
Does feedback FX build up? Every family preset claims "never repeats" and
nothing checks it. A6 shows that the core of `additive` repeats by
construction.

### B4. Perceived loudness (LUFS) and level-matched presets

The presets span **−24 dB (*Aurora*, *Loom*) to −35 dB (*Bell spots*)**
RMS: an 11 dB jump when switching. BS.1770 K-weighted loudness, a test
that keeps presets within ±3 LU, and leveling through `masterGain`. The
scout's "more than 6 dB quieter" penalty would then be perceptual too.

### B5. Before/after diff for DSP changes (`--compare base.json`)

Per preset, flag the metrics that moved beyond their render spread. Today a
refactor of `engine.ts` could silently change every preset's sound. Needs
B1 to be meaningful.

### B6. A character-aware scout — *measured: not needed yet*

The scout ranks 👍/👎 candidates by fractality minus a loudness penalty.
With `character.ts` it could also penalize leaving the point's own
character (the band breaks, the bass goes, the grid is lost), so that
"More of this" keeps a drone a drone.

Measured first (`--mutants 4 --character --ref 0,3,5,6,8`, 24 one-step
proposals from the family and *Overtone steppe*): **none left the family**.
Their distances were 0.69–1.56, against 0.65–1.25 for the family's own
members. The most fragile trait was continuity: 3 of *Overtone steppe*'s 4
proposals dropped out deeper (dropout 6.9–8.1 dB, from 6.4, already at the
family's edge). One proposal kept the character but lost fractality
(0.92 → 0.61, cenβ 0.24): that is the scout's existing job. Revisit after
measuring 10-step walks, where drift adds up.

### B7. Real preferences instead of proxies

Every metric here is a proxy that nobody has checked against what people
actually like: *Silver maze* 0.99 and *Molten Polivoks* 0.49 were both
liked. The app already produces the signal: 👍/👎 presses, and how long a
point is listened to. Logged anonymously to the existing Worker/D1, that
would let us fit what people prefer and recalibrate `fractalScore`.
Needs your decision: privacy, a consent line in the UI, storage.

### B8. The picture has no measurement at all

Coverage, edge density and the frame-to-frame change of the simulation
state over 5 minutes would catch "the pattern died" (chromaflux's advection
problem) and "the coupling does nothing". *Overtone steppe*'s picture was
checked by screenshots at 2 and 5 minutes: slow, and by eye.

### B9. Analysis still burns two cores on the app's own loop

`analyze.mjs` now opens the app at `?res=64&scale=64` (it used to paint a
full canvas, and a 60 s render went from ~20 s to 60–190 s). The loop
still runs at full frame rate, and the GPU process still takes ~2 cores.
A `?paused=1` for the frame loop would free them for parallel renders.
