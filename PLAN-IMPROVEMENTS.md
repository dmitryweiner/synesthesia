# PLAN-IMPROVEMENTS — proposals, not decisions

Ideas collected while building *Overtone steppe* (2026-09-25): new sound
mechanics in the style the project already has (drone / ambient), and the
measurements we are missing. **Nothing here is agreed.** An item that gets
agreed moves to PLAN.md "Decisions" with a number and a date.

*Reviewed with the user on 2026-09-26* (PLAN.md #18–24): A1, A2, A4, A5,
B1, B2, B8 and B9 were agreed and moved to PLAN.md; A8 was rejected. What is
left here was **deferred**, not rejected. The removed items' full text,
with the pink-LFO prototype's per-preset table, is in git history.

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
| *Overtone steppe* (first version) | ~0.9 | 5.6 | 11 | 0.90 | 0.96 | 0.08 | 5.0 → 7.3 |

In words: a band that never breaks, weight in the bass, one harmonic grid,
slow change, and **nothing that repeats** (every family preset runs its
LFOs at mutually irrational rates). Fractality alone does not describe it:
*Molten Polivoks* was liked at 0.49.

---

## A. Sound generation

Ordered by value for effort. (Numbering kept from the first version.)

### A3. "Stay on the grid": harmonic snap for pitch

A route flag (and/or a mutation rule) that snaps an `exp` frequency to the
nearest harmonic of the point's fundamental, with the existing FX smoothing
as a glide. Why: the family keeps every voice on one grid (harmonicity
0.5–0.9, against 0.35 for the noise/drip presets). Today a pitch LFO or a
mutation of `fm.fc` / `quasi.fq` / `logistic.base` drifts off it, and
inharmonic partials rub against a drone. formula-synth's *Silver lace*
comment records trying a Risset bell for that reason and dropping it. For
the whistle, S&H would jump exactly from overtone to overtone (with routes
adding up, PLAN #19, on top of the glide).
Measure: `harm` and `rough` of 👍/👎 proposals before and after.

### A6. A drone whose inner life never repeats

`additive`'s partial amplitudes are one travelling wave,
aₖ = sin(φ + k)/k, so the whole inner pattern repeats **exactly** every
1/`move` seconds (20 s at *Overtone steppe*'s 0.05 Hz). A variant, a new
formula or a `spread` parameter, would give each partial its own slow drift
(incommensurate rates like `move·√k`, or the pink LFO of PLAN #18 per
partial) plus a tiny
per-partial detune (±0.1–0.3 Hz), so the partials beat slowly like a choir.
That matches what the family is built on (LFOs at unrelated rates), applied
to the drone's core. Measure with B3.

### A7. Stereo for headphones

The generators are mono (`outputChannelCount: [1]`); only the reverb tail
is stereo. The cheapest big win for ambient on headphones: `beats` as
**binaural** (f left, f + Δf right, so the 0.5 Hz beat happens inside the
head), and a slow autopan of the ornament voices. Risk: phones often play
mono; check mono compatibility (L+R must not cancel).

## B. Evaluation: what we're missing

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
refactor of `engine.ts` could silently change every preset's sound. The
seeded reverb (PLAN #21) is what makes it meaningful.

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

