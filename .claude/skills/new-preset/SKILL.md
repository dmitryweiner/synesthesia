---
name: new-preset
description: Create a new built-in Synesthesia preset (sound + picture), or retune an existing one, the way Overtone steppe was made — profile the presets people liked, pick one new idea, render drafts side by side, compare them in the same reverb rooms, check the picture over minutes, verify, hand WAVs to the user. Use when the user asks for a new preset, a variation of one, or to change how a preset sounds or looks ("the bass is too rough", "make it brighter", "a darker picture").
---

# Create or retune a preset

There are no speakers on this machine: the user's ears are the judge, and
the numbers are how you get to something worth their time. Load the
`sound-check` skill too, because it explains every metric used here.

## 0. What people like (start here)

The presets people liked most are formula-synth's FX-mod family: here *Fractal
garden* (0), *Molten Polivoks* (3), *Silver maze* (5), *Space breccia* (6),
*Loom & copper* (8). The user calls the style drone / ambient. Their profile
(`--character --ref 0,3,5,6,8`, 60 s):

| | fractality | dropout | swing | low < 200 Hz | harmonicity | motion 1 s → 10 s |
|---|---|---|---|---|---|---|
| family | 0.47–0.99 | 3.6–6.0 dB | 9–17 dB | 0.73–0.96 | 0.50–0.88 | 4.4–5.8 → 7–10 |
| drips / wind / bells | 0.52–0.68 | 8–13 dB | 16–18 dB | 0.00–0.21 | 0.35–0.80 | up to 8 → 19 |

In words: a band that never breaks, one harmonic grid (everything on
multiples of one fundamental), slow change, 4 LFOs at mutually irrational
rates (0.017–0.06 Hz sine/triangle plus S&H ~0.03 Hz) so that nothing
repeats, a chain of chorus + phaser + delay + reverb, and a limiter.
Fractality alone doesn't describe it (Polivoks was liked at 0.49).

The user's own taste (memory `sound-taste`): bright, resonant overtone
detail on top is loved ("5+"). The bass must be **round, fat and melodic,
not rough**. Attacks sparse and lyrical (the tanpura's plucks were asked to
come half as often), slow breathing layers underneath (bowls, waves), and
a calm piece still needs high, never-repeating iridescence, or it reads as
monotonous (PLAN.md #25–26). A 55 Hz sawtooth's low harmonics are rough by themselves; the
cure is a strong smooth fundamental under them (e.g. `dist` at α ≈ 0.9 is
an almost pure sine), not removing grit elsewhere.

## 1. One new idea, and a picture that shares it

Take what the family has, add **one** move it doesn't make yet, and write
it into the preset's comment. Already used: comb-filter moiré (Loom,
Fractal garden), a peaking glow (Silver maze), a resonant LP sweep
(Polivoks), Shepard grids, logistic bifurcations, FM fans, a Q-30 overtone
whistle (Overtone steppe). Mechanics added on 2026-09-26 and not yet
used widely yet: the **pink** LFO shape (1/f wandering, PLAN.md #18), the
**tanpura** formula (plucked Pa–Sa–Sa–Sa strings with jawari buzz),
**delay shimmer** (every echo an octave up), PLAN.md #20, and the
**bowl** formula (a breathing singing-bowl hum, PLAN.md #25). *Candle
glaze* and *Tanpura halo* use them. More candidate
moves are in PLAN-IMPROVEMENTS.md, part A. Some need new mechanics: agree
those with the user first.

The picture carries the same idea through a **shared LFO**: the one that
moves the sound's main gesture also drives a visual parameter (Feed,
lightAngle, shift, drift). Materials, palettes and their users are in
`src/presets.ts`; the chromaflux materials are all used, so combine cards
anew. Found so far: Marble + a steady Drift X ("wind") read well; Basalt
and Verdigris came out muddy under the warm tint that bass-heavy sounds get
(`spectrumToTint` tints dark tones by the bass).

Hard limits (tests/presets.test.ts): ≤ 5 formulas, ≤ 12 routes, every value
inside its slider range, the explicit couplings sum ≥ 1.2, and at least
one visual route or coupling. Two routes on the **same parameter add
up** (PLAN.md #19; octaves for exp routes, clamped once), so a slow
contour plus rare S&H leaps is possible. S&H should only step things whose
step can't be heard. FX parameters are smoothed, but a step in
saturation drive is audible grit.

## 2. Draft and variants, rendered side by side

Write the draft with `preset(…)` at the end of `PRESETS` (it becomes index
N). For its variants, append a **temporary** block to `src/presets.ts`;
`analyze.mjs` renders it after the built-ins (N+1, N+2, …):

```ts
// TEMP: variants — remove before committing (tests/presets.test.ts fails otherwise)
function variant(name: string, fn: (s: AppState) => void): Preset {
  const s: AppState = JSON.parse(JSON.stringify(PRESETS[12].state));
  s.presetName = name;
  fn(s);
  return { name, state: stateToAppState(s) };
}
export const VARIANTS: readonly Preset[] = [
  variant('A phaser', (s) => { Object.assign(s.audio.fx, { phaserOn: true, phaserMix: 0.35 }); }),
];
```

```bash
node scripts/analyze.mjs --preset 12,13,14 --secs 60 --character --repeat 2 --wav shots/wav --png shots/png
```

- **Renders repeat exactly** (PLAN.md #21): the reverb room and the noise
  formulas are seeded, so one seed renders the same samples in every run,
  and `--repeat N` renders seeds 1..N, the same N rooms for every point.
  The room still moves the score (±0.05, up to 0.14 for *Overtone steppe*
  between seeds), so compare with `--repeat` ≥ 2. The old "a whole run
  shifted by 0.2" did not recur in six seeded runs; if a seed's score ever
  differs between runs, that is a render bug.
- **Look at it:** `--png` draws each render's log-frequency waterfall over
  its loudness curve. Read the PNGs: a whistle, a pluck, a dropout or a
  build-up is obvious there and slow to prove with a metric. (It showed
  that every render starts with ~6 s of broadband reverb tail from the
  generators switching on; ignore the first seconds.)
- A draft whose envβ sits near 2 is on the steep side of the preference
  curve: its score jumps between renders. Fix the sound (in the whistle
  draft, adding the phaser took it from 0.46 to ~0.9), not the measurement.
- Don't edit `src/` while a run is going (Vite reloads the page and the run
  dies). Make the edit between runs.

## 3. Changing one part? Compare in the same rooms, and prove the rest stayed

When you retune a part of the sound (the bass, the top), the room moves
those very metrics more than your variants do: the same point read low-end
roughness 0.046 and 0.034 in two random rooms. Renders are seeded now, so
compare in the same rooms, from a snapshot so you can keep editing:

```bash
node .claude/skills/new-preset/snapshot.mjs /tmp/…/snap   # re-run after every edit
cd /tmp/…/snap && node scripts/analyze.mjs --preset 12,13,14 --secs 60 --repeat 3 --wav /tmp/…/out
node <project>/.claude/skills/new-preset/bands.mjs /tmp/…/out/seed1 --f0 55 --keep 600-2400
```

Render k uses seed k for every point. Believe a ranking only when all
seeds agree. `bands.mjs` reports bass roughness, fundamental share, body,
grit and wobble, and the `--keep` band's Δ dB and correlation against the
first file: **0.0 / 1.00 means the band you promised not to touch did not
move.**

## 4. Check the idea itself, not only the scores

Fractality won't tell you whether the idea works. Test it with an on/off
pair on the WAVs. For the whistle: per harmonic, the render with the
resonance minus the same render without it was +10…25 dB under the
resonance. A "does one harmonic lead the whole register" metric could not
tell the whistle from the drone's own ripple, and cost an hour: prefer the
simplest paired difference.

## 5. The picture, over minutes

```bash
for i in 12 13 14; do node scripts/snap.mjs --out shots/p$i.png --preset $i --res 256 --sound --wait 120000 & done; wait
node scripts/snap.mjs --out shots/p12-5min.png --preset 12 --res 256 --sound --wait 300000
```

Always `--sound`, because the couplings change the colours. Compare 2–3
palettes/materials in parallel at 2 min, then check the winner at 5 min:
it must not die out (advection erodes high-Feed regimes) and must fill the
canvas.

## 6. Final checks

```bash
node scripts/analyze.mjs --character --ref 0,3,5,6,8 --preset 0,3,5,6,8,12 --repeat 2   # distance ≲ 1.3, nothing > 2 sd unless intended
node scripts/analyze.mjs --onsets --preset 12,0      # swell range → set loudToPulse so exposure (1 + 0.6·pulse·swell) stays ~0.75–1.4
node scripts/analyze.mjs --switch 11,12,0,12 --at 30 # 0 clicks at switches and inside the preset
npm run check && npm run smoke && npm run build      # the verify skill
```

- Remove the TEMP block and check that `grep -c VARIANTS src/presets.ts` is 0.
- Write the preset's comment in the style of the others: the idea, which
  LFO is shared with the picture, and the measured numbers.
- Update the preset count in AGENTS.md (module map).

## 7. Hand it to the user

- Render listening WAVs at 44.1 kHz, **in the same room** (no `--repeat`:
  seed 1, the room the app plays), into `shots/<preset>/` (gitignored), e.g.
  `1-before.wav`, `2-gentler.wav`, `3-after.wav`. The user listens, you
  can't.
- Ask what they hear. Once they accept, record it in PLAN.md "Decisions"
  (numbered, dated, with the numbers), and put new taste facts into the
  `sound-taste` memory.
- Commit (preset + docs/ build). Push only when asked.
- **Leave no server running:** `pgrep -af '[b]in/vite'` must print nothing.
  The scripts stop their own servers; stop anything you started by hand.
