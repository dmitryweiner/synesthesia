// App wiring: the two engines, the rAF loop (visual sim + LFO/coupling),
// the explorer (like / dislike / surprise / undo), morphing between points,
// presets, share links and the small HUD. Everything with logic worth
// testing lives in pure modules; this file only connects them.
import './style.css';
import { el, make } from './ui/dom';
import { renderDetails } from './ui/details';
import { SimEngine } from './sim/engine';
import { gridSize } from './sim/grid';
import { AudioEngine } from './audio/engine';
import { FeatureTracker, OnsetDetector, SILENT_FEATURES } from './audio/features';
import type { AudioFeatures } from './audio/features';
import { effectiveParams } from './dsp/mod';
import { CARDS, cardSliderRanges } from './schema/visual';
import { fieldVariationParamsFromCard, flowParamsFromCard, reactionParamsFromCard, ZERO_FIELD_VARIATION, ZERO_FLOW } from './sim/params';
import { composePalette, palettesByIndex } from './palette';
import { applyCoupling } from './coupling';
import { RippleSet, displayCoupling } from './visualFx';
import type { AppState } from './state/schema';
import { cloneAppState, stateToAppState } from './state/schema';
import { decodeStateToken, encodeStateToken } from './state/share';
import { cleanUrl, parseLaunch, withPresetId } from './state/launch';
import { fetchPoint, sharePoint } from './state/cloud';
import { loadLastPoint, saveLastPoint } from './state/lastPoint';
import { loadUserPresets, saveUserPresets, suggestPointName } from './state/userPresets';
import { keepScreenAwake } from './ui/wakelock';
import type { UserPreset } from './state/userPresets';
import { PRESETS, DEFAULT_PRESET_INDEX } from './presets';
import { decodeGenome, encodeGenome } from './genome/codec';
import type { Genome } from './genome/codec';
import { diffSummary, lerpGenome } from './genome/evolve';
import { Explorer } from './genome/explorer';
import type { ExplorerAction } from './genome/explorer';
import { Scout } from './genome/scout';
import type { ScoutPick } from './genome/scout';
import { analyzeSound } from './analysis/fractal';

const MORPH_SECONDS = 2.0;
const UNDO_MORPH_SECONDS = 0.8;
const AUDIO_PUSH_INTERVAL = 0.05; // s — how often a morph re-sends params to the worklets
const HELP_SHOWN_KEY = 'synesthesia_help_shown';
// Scout (PLAN.md decision 7): offline-render + score candidates in the
// background while the user listens. `?scout=0` turns it off.
const SCOUT_ENABLED = new URLSearchParams(location.search).get('scout') !== '0';
// 24 s at 8 kHz costs about the same as 8 s at 16 kHz but ranks candidates
// far closer to a 30 s / 22 kHz reference (Spearman ρ 0.73 vs 0.23, measured
// with `analyze.mjs --configs`): slow LFOs need the long window, the fractal
// metrics don't need high frequencies.
const SCOUT_SECONDS = 24;
const SCOUT_SR = 8000;
const SCOUT_DELAY_MS = 800; // after a morph settles, before rendering starts

const canvas = el('view', HTMLCanvasElement);
const webglError = el('webglError', HTMLParagraphElement);
const status = el('status', HTMLParagraphElement);
const details = el('details', HTMLElement);
const audioBtn = el('audioBtn', HTMLButtonElement);
const volume = el('volume', HTMLInputElement);
const presetSel = el('presetSel', HTMLSelectElement);
const undoBtn = el('undoBtn', HTMLButtonElement);
const reseedBtn = el('reseedBtn', HTMLButtonElement);
const saveBtn = el('saveBtn', HTMLButtonElement);
const shareBtn = el('shareBtn', HTMLButtonElement);
const detailsBtn = el('detailsBtn', HTMLButtonElement);
const helpBtn = el('helpBtn', HTMLButtonElement);
const helpBox = el('help', HTMLDivElement);
const helpCloseBtn = el('helpCloseBtn', HTMLButtonElement);
const helpCloseX = el('helpCloseX', HTMLButtonElement);
const detailsBody = el('detailsBody', HTMLDivElement);
const detailsCloseBtn = el('detailsCloseBtn', HTMLButtonElement);
const likeBtn = el('likeBtn', HTMLButtonElement);
const dislikeBtn = el('dislikeBtn', HTMLButtonElement);
const surpriseBtn = el('surpriseBtn', HTMLButtonElement);

// Slider ranges per visual card, for the LFO matrix's effectiveParams clamp.
const VISUAL_RANGES: Record<string, Record<string, readonly [number, number]>> = {};
for (const card of CARDS) VISUAL_RANGES[card.id] = cardSliderRanges(card);

function resizeCanvas(): void {
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  canvas.width = Math.max(1, Math.floor(rect.width * dpr));
  canvas.height = Math.max(1, Math.floor(rect.height * dpr));
}

// Button text is "<icon> <label>"; they're split into two spans so narrow
// screens can hide the label (style.css). dataset.text keeps the resting
// text so flash() can restore it even if it fires twice in a row.
function setBtnText(btn: HTMLButtonElement, text: string, resting = true): void {
  const i = text.indexOf(' ');
  const ico = i < 0 ? text : text.slice(0, i);
  const label = i < 0 ? '' : text.slice(i + 1);
  btn.replaceChildren(make('span', 'ico', ico), make('span', 'lbl', label));
  if (resting) btn.dataset.text = text;
}

const flashTimers = new WeakMap<HTMLButtonElement, ReturnType<typeof setTimeout>>();
function flash(btn: HTMLButtonElement, text: string): void {
  setBtnText(btn, text, false);
  btn.classList.add('flash');
  clearTimeout(flashTimers.get(btn));
  flashTimers.set(btn, setTimeout(() => {
    setBtnText(btn, btn.dataset.text ?? text);
    btn.classList.remove('flash');
  }, 900));
}

for (const btn of document.querySelectorAll('button.tb-btn, button.fb-btn')) {
  if (btn instanceof HTMLButtonElement) setBtnText(btn, (btn.textContent ?? '').trim());
}

// `?res=N` overrides the simulation grid (64..2048) — for weak devices and
// for the headless scripts, where SwiftShader renders a few fps at 1024².
// `?api=` points Share at a local points Worker (scripts/smoke.mjs runs one
// in Miniflare). Only localhost is honored, so a crafted link can't send
// people's points to someone else's server.
function apiOverride(): string | undefined {
  const raw = new URLSearchParams(location.search).get('api');
  if (!raw) return undefined;
  try {
    const u = new URL(raw);
    if (u.hostname === 'localhost' || u.hostname === '127.0.0.1') return u.origin;
  } catch {
    // not a URL
  }
  return undefined;
}

function simResolution(): number {
  const q = Number(new URLSearchParams(location.search).get('res'));
  if (Number.isFinite(q) && q >= 64) return Math.min(2048, Math.round(q));
  return Math.min(window.innerWidth, window.innerHeight) < 700 ? 512 : 1024;
}

function boot(): void {
  resizeCanvas();
  let sim: SimEngine;
  try {
    sim = new SimEngine({ canvas, ...gridSize(simResolution(), canvas.width, canvas.height) });
  } catch (err) {
    webglError.hidden = false;
    status.textContent = err instanceof Error ? err.message : 'WebGL2 unavailable.';
    return;
  }
  window.addEventListener('resize', () => {
    resizeCanvas();
    const g = gridSize(simResolution(), canvas.width, canvas.height);
    sim.setGrid(g.width, g.height);
  });

  const audio = new AudioEngine();
  let features: AudioFeatures = { ...SILENT_FEATURES };
  const onsets = new OnsetDetector();
  const ripples = new RippleSet();
  let lastFrame = 0;
  // Observable effect stats for scripts/smoke.mjs (body[data-fx-hits],
  // body[data-fx-exposure] = "min-max" over the last ~2 s).
  let fxHits = 0;
  let expoMin = 1;
  let expoMax = 1;
  let expoWindowStart = 0;
  let tracker: FeatureTracker | null = null;
  let timeDomain = new Float32Array(0);
  let freqBins = new Uint8Array(0);

  // --- the point --------------------------------------------------------
  // `state` is the live, fully-decoded AppState of the genome currently
  // being rendered (during a morph: the interpolated one). masterGain and
  // presetName aren't genes and are kept on the side.
  let masterGain = 0.75;
  let presetName: string | undefined;
  let state: AppState = PRESETS[DEFAULT_PRESET_INDEX].state;
  const explorer = new Explorer(encodeGenome(state));
  let stepCount = 0;

  // Morph bookkeeping: `live` eases from `morphFrom` to `morphTo`; a press
  // mid-morph starts the next morph from `live` (what's audible/visible now).
  let morphFrom: Genome = explorer.current;
  let morphTo: Genome = explorer.current;
  let live: Genome = explorer.current;
  let morphStart = 0;
  let morphSeconds = MORPH_SECONDS;
  let morphDone = true;
  let lastAudioPush = -1;

  // --- shared LFO clock ---------------------------------------------------
  // Audio worklets run their LFOs on their own sample clock starting at the
  // moment audio starts; the visual loop follows audio.time whenever audio
  // runs, so a route on LFO 1 breathes the same way in both.
  let clockOffset = performance.now() / 1000;
  function lfoTime(): number {
    if (audio.running) return audio.time;
    return performance.now() / 1000 - clockOffset;
  }

  function applyToEngines(s: AppState, force: boolean): void {
    state = s;
    if (audio.running) {
      const t = lfoTime();
      if (force || t - lastAudioPush >= AUDIO_PUSH_INTERVAL) {
        lastAudioPush = t;
        audio.applyState({ masterGain, fx: s.audio.fx, formulas: s.audio.formulas, mod: s.mod });
      }
    }
  }

  function startMorph(to: Genome, seconds: number): void {
    morphFrom = live;
    morphTo = to;
    morphStart = performance.now() / 1000;
    morphSeconds = seconds;
    morphDone = false;
  }

  function morphProgress(): number {
    if (morphDone) return 1;
    const t = (performance.now() / 1000 - morphStart) / morphSeconds;
    return Math.max(0, Math.min(1, t));
  }

  function tickMorph(): void {
    if (morphDone) return;
    const p = morphProgress();
    // ease-in-out so the change reads as a glide, not a jump
    const eased = p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2;
    live = lerpGenome(morphFrom, morphTo, p >= 1 ? 1 : eased);
    applyToEngines(decodeGenome(live), p >= 1);
    if (p >= 1) {
      morphDone = true;
      morphFrom = morphTo;
      onSettled();
    }
  }

  // --- UI state --------------------------------------------------------
  function setStatus(text: string): void {
    status.textContent = text;
  }

  function describeChange(from: Genome, to: Genome): string {
    const changes = diffSummary(from, to);
    if (changes.length === 0) return 'nothing changed';
    const arrow = { up: '↑', down: '↓', on: 'on', off: 'off', switch: '⇄' };
    const top = changes.slice(0, 5).map((c) => `${c.label} ${arrow[c.dir]}`);
    const more = changes.length > 5 ? ` +${changes.length - 5} more` : '';
    return top.join(' · ') + more;
  }

  function actionLabel(a: ExplorerAction): string {
    switch (a) {
      case 'like': return '👍 continuing this way';
      case 'dislike': return '👎 back to the last liked point, trying elsewhere';
      case 'surprise': return '🎲 jumped somewhere new';
      case 'undo': return '↩ undone';
      case 'load': return 'loaded';
    }
  }

  function refreshUndo(): void {
    undoBtn.disabled = !explorer.canUndo;
    setBtnText(undoBtn, explorer.canUndo ? `↩ Undo (${explorer.undoDepth})` : '↩ Undo');
  }

  function currentState(): AppState {
    const s = cloneAppState(decodeGenome(explorer.current));
    s.audio.masterGain = masterGain;
    if (presetName) s.presetName = presetName;
    return s;
  }

  // The address bar no longer carries the point (PLAN.md decision 9): it is
  // kept in localStorage instead, so a reload comes back to it.
  function onSettled(): void {
    if (!details.hidden) renderDetails(detailsBody, state, scout?.parent ?? null);
    saveLastPoint(currentState());
    scheduleScout();
  }

  // --- scout ---------------------------------------------------------------
  const scout = SCOUT_ENABLED
    ? new Scout({
      k: 3,
      render: (s) => AudioEngine.renderOffline(
        { masterGain: s.audio.masterGain, fx: s.audio.fx, formulas: s.audio.formulas, mod: s.mod },
        SCOUT_SECONDS, SCOUT_SR,
      ),
      analyze: (x) => analyzeSound(x, SCOUT_SR),
      onProgress: () => {
        document.body.dataset.scout = `${scout?.ready('like') ?? 0}/${scout?.ready('dislike') ?? 0}`;
        if (!details.hidden) renderDetails(detailsBody, state, scout?.parent ?? null);
      },
    })
    : null;
  let scoutTimer: ReturnType<typeof setTimeout> | null = null;

  function scheduleScout(): void {
    if (!scout || scout.disabled) return;
    if (scoutTimer !== null) clearTimeout(scoutTimer);
    scoutTimer = setTimeout(() => {
      scoutTimer = null;
      if (!audio.running || !morphDone) return;
      document.body.dataset.scout = '0/0';
      scout.prepare(explorer, masterGain);
    }, SCOUT_DELAY_MS);
  }

  function stopScout(): void {
    if (scoutTimer !== null) clearTimeout(scoutTimer);
    scoutTimer = null;
    scout?.cancel();
    delete document.body.dataset.scout;
  }

  let userPresets: UserPreset[] = loadUserPresets();
  function refreshPresetList(): void {
    presetSel.replaceChildren();
    const placeholder = make('option', undefined, '— point —');
    placeholder.value = '';
    presetSel.appendChild(placeholder);
    // Saved points first: a point saved a second ago must be visible without
    // scrolling past a dozen built-ins (users read that as "it didn't save").
    if (userPresets.length > 0) {
      const mine = make('optgroup');
      mine.label = 'My points';
      userPresets.forEach((p, i) => {
        const o = make('option', undefined, `💾 ${p.name}`);
        o.value = `u:${i}`;
        mine.appendChild(o);
      });
      presetSel.appendChild(mine);
    }
    const builtin = make('optgroup');
    builtin.label = 'Built-in';
    PRESETS.forEach((p, i) => {
      const o = make('option', undefined, `${i}: ${p.name}`);
      o.value = `b:${i}`;
      builtin.appendChild(o);
    });
    presetSel.appendChild(builtin);
    presetSel.value = '';
  }

  // --- actions -----------------------------------------------------------
  function afterAction(prev: Genome, seconds: number, pick: ScoutPick | null = null): void {
    stopScout();
    // stepped away from whatever the URL pointed at (shared id / preset)
    history.replaceState(null, '', cleanUrl(location.href));
    stepCount++;
    presetName = undefined;
    presetSel.value = '';
    startMorph(explorer.current, seconds);
    refreshUndo();
    const scouted = pick ? ` · scouted: best of ${pick.of} (fractal ${pick.analysis.score.toFixed(2)})` : '';
    setStatus(`${actionLabel(explorer.lastAction)} · step ${stepCount} · spread ${explorer.sigma.toFixed(2)}${scouted}\n${describeChange(prev, explorer.current)}`);
  }

  function like(): void {
    const prev = explorer.current;
    const pick = scout?.take(explorer, 'like') ?? null;
    explorer.like(pick?.genome);
    afterAction(prev, MORPH_SECONDS, pick);
    flash(likeBtn, '👍 Liked');
  }

  function dislike(): void {
    const prev = explorer.current;
    const pick = scout?.take(explorer, 'dislike') ?? null;
    explorer.dislike(pick?.genome);
    afterAction(prev, MORPH_SECONDS, pick);
    flash(dislikeBtn, '👎 Noted');
  }

  function surprise(): void {
    const prev = explorer.current;
    // Any built-in preset except the one we're closest to by name.
    const pool = PRESETS.filter((p) => p.name !== presetName);
    const pick = pool[Math.floor(Math.random() * pool.length)] ?? PRESETS[0];
    explorer.surprise(encodeGenome(pick.state));
    afterAction(prev, MORPH_SECONDS);
    sim.reseed();
    flash(surpriseBtn, `🎲 near "${pick.name}"`);
  }

  function undo(): void {
    const prev = explorer.current;
    if (!explorer.undo()) return;
    afterAction(prev, UNDO_MORPH_SECONDS);
  }

  /** Load a whole point (preset / link): fresh search, image reseeded. */
  function loadState(s: AppState, label: string, url: string = cleanUrl(location.href)): void {
    history.replaceState(null, '', url);
    presetName = s.presetName;
    masterGain = s.audio.masterGain;
    volume.value = String(masterGain);
    stopScout();
    explorer.load(encodeGenome(s));
    stepCount = 0;
    morphFrom = explorer.current;
    morphTo = explorer.current;
    live = explorer.current;
    morphDone = true;
    // A hard switch, not a morph: the engine ducks, rebuilds its FX (no tails
    // of the previous point) and fades the new one in — see switchTo().
    state = decodeGenome(explorer.current);
    if (audio.running) {
      lastAudioPush = lfoTime();
      void audio.switchTo({ masterGain, fx: state.audio.fx, formulas: state.audio.formulas, mod: state.mod });
    }
    sim.reseed();
    refreshUndo();
    setStatus(`${label}: ${s.presetName ?? 'unnamed point'}`);
    onSettled();
  }

  // Phones dim the screen while you watch: take a wake lock on the first
  // gesture (that's when browsers grant it) and re-take it after the tab was
  // hidden — see ui/wakelock.ts.
  function stayAwake(): void {
    void keepScreenAwake().then((ok) => {
      if (ok) document.body.dataset.awake = '1';
    });
  }
  for (const ev of ['pointerdown', 'keydown']) {
    document.addEventListener(ev, stayAwake, { once: true });
  }

  likeBtn.addEventListener('click', like);
  dislikeBtn.addEventListener('click', dislike);
  surpriseBtn.addEventListener('click', surprise);
  undoBtn.addEventListener('click', undo);
  reseedBtn.addEventListener('click', () => {
    sim.reseed();
    flash(reseedBtn, '🌱 Reseeded');
  });

  presetSel.addEventListener('change', () => {
    const v = presetSel.value;
    if (!v) return;
    const idx = Number(v.slice(2));
    const p = v.startsWith('b:') ? PRESETS[idx] : userPresets[idx];
    if (!p) return;
    loadState(cloneAppState(p.state), 'loaded');
    presetSel.value = v;
  });

  saveBtn.addEventListener('click', () => {
    const suggested = suggestPointName(presetName, userPresets);
    const name = window.prompt('Name this point:', suggested);
    if (name === null) return;
    const s = currentState();
    s.presetName = name.trim() || suggested;
    presetName = s.presetName;
    const existing = userPresets.findIndex((p) => p.name === s.presetName);
    if (existing >= 0) userPresets[existing] = { name: s.presetName, state: s };
    else userPresets.push({ name: s.presetName, state: s });
    saveUserPresets(userPresets);
    userPresets = loadUserPresets();
    refreshPresetList();
    presetSel.value = `u:${userPresets.findIndex((p) => p.name === s.presetName)}`;
    flash(saveBtn, '💾 Saved');
    setStatus(`saved as “${s.presetName}” — it's at the top of the list, under “My points”`);
    onSettled();
  });

  // 🔗 Share: store the point in the cloud and copy a short ?presetId= link;
  // if the points Worker is unreachable, fall back to the long #s= link.
  // The clipboard write is started synchronously with a promised payload
  // (ClipboardItem) so Safari still treats it as part of the click.
  const api = apiOverride();
  async function shareLink(s: AppState): Promise<{ url: string; short: boolean }> {
    try {
      const id = await sharePoint(s, { api });
      const url = withPresetId(location.href, id);
      history.replaceState(null, '', url);
      return { url, short: true };
    } catch {
      return { url: `${cleanUrl(location.href)}#s=${encodeStateToken(s)}`, short: false };
    }
  }

  shareBtn.addEventListener('click', async () => {
    shareBtn.disabled = true;
    const pending = shareLink(currentState());
    let copied = false;
    try {
      if (typeof ClipboardItem !== 'undefined' && navigator.clipboard?.write) {
        const blob = pending.then((r) => new Blob([r.url], { type: 'text/plain' }));
        await navigator.clipboard.write([new ClipboardItem({ 'text/plain': blob })]);
        copied = true;
      }
    } catch {
      // fall through to writeText / prompt
    }
    const { url, short } = await pending;
    if (!copied) {
      try {
        await navigator.clipboard.writeText(url);
        copied = true;
      } catch {
        window.prompt('Copy this link:', url);
      }
    }
    shareBtn.disabled = false;
    if (copied) flash(shareBtn, short ? '🔗 Copied' : '🔗 Copied (long)');
    setStatus(short ? `short link copied: ${url}` : 'share server unreachable — copied a long link instead');
  });

  function closeDetails(): void {
    details.hidden = true;
  }
  detailsBtn.addEventListener('click', () => {
    details.hidden = !details.hidden;
    if (!details.hidden) renderDetails(detailsBody, state, scout?.parent ?? null);
  });
  detailsCloseBtn.addEventListener('click', closeDetails);

  function openHelp(): void { helpBox.hidden = false; }
  function closeHelp(): void {
    helpBox.hidden = true;
    try { localStorage.setItem(HELP_SHOWN_KEY, '1'); } catch { /* private mode */ }
  }
  helpBtn.addEventListener('click', openHelp);
  helpCloseBtn.addEventListener('click', closeHelp);
  helpCloseX.addEventListener('click', closeHelp);
  helpBox.addEventListener('click', (e) => { if (e.target === helpBox) closeHelp(); });

  // --- audio -------------------------------------------------------------
  async function startAudio(): Promise<void> {
    if (audio.running) return;
    audioBtn.disabled = true;
    try {
      await audio.start({ masterGain, fx: state.audio.fx, formulas: state.audio.formulas, mod: state.mod });
    } catch (err) {
      setStatus(`audio failed: ${err instanceof Error ? err.message : String(err)}`);
      audioBtn.disabled = false;
      return;
    }
    audioBtn.disabled = false;
    setBtnText(audioBtn, '⏹ Sound');
    audioBtn.classList.add('running');
    const analyser = audio.analyser;
    if (analyser) {
      timeDomain = new Float32Array(analyser.fftSize);
      freqBins = new Uint8Array(analyser.frequencyBinCount);
      tracker = new FeatureTracker(audio.sampleRate);
    }
    lastAudioPush = -1;
    scheduleScout();
  }

  async function stopAudio(): Promise<void> {
    if (!audio.running) return;
    clockOffset = performance.now() / 1000 - audio.time; // keep the LFO clock continuous
    stopScout();
    await audio.stop();
    tracker = null;
    features = { ...SILENT_FEATURES };
    setBtnText(audioBtn, '▶ Sound');
    audioBtn.classList.remove('running');
  }

  audioBtn.addEventListener('click', () => {
    if (audio.running) void stopAudio();
    else void startAudio();
  });

  volume.addEventListener('input', () => {
    masterGain = Number(volume.value);
    audio.setMasterGain(masterGain);
  });

  document.addEventListener('keydown', (e) => {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
    if (!helpBox.hidden) { if (e.key === 'Escape' || e.key === 'Enter') closeHelp(); return; }
    if (e.key === 'Escape' && !details.hidden) { closeDetails(); return; }
    switch (e.key) {
      case 'ArrowRight': like(); break;
      case 'ArrowLeft': dislike(); break;
      case 'ArrowUp': surprise(); break;
      case 'Backspace': case 'z': undo(); break;
      case ' ': e.preventDefault(); audioBtn.click(); break;
      default: return;
    }
    e.preventDefault();
  });

  // --- the frame loop ----------------------------------------------------
  function effectiveCards(t: number): Record<string, Record<string, number>> {
    const out: Record<string, Record<string, number>> = {};
    for (const card of CARDS) {
      const cs = state.visual.cards[card.id];
      out[card.id] = effectiveParams(card.id, cs.params, state.mod.lfos, state.mod.routes, VISUAL_RANGES[card.id], t);
    }
    return out;
  }

  // Onset hit → fresh growth at a random spot + a ripple from it
  // (onsetToSeed, PLAN.md decision 8).
  function seedOnHit(now: number): void {
    const amount = state.coupling.onsetToSeed;
    if (amount < 0.02) return;
    const x = 0.08 + Math.random() * 0.84;
    const y = 0.08 + Math.random() * 0.84;
    sim.inject([x, y], 0.015 + 0.035 * amount, Math.min(1, 0.4 + amount));
    ripples.add(x, y, amount, now);
    document.body.dataset.fxHits = String(++fxHits);
  }

  function trackExposure(exposure: number, now: number): void {
    expoMin = Math.min(expoMin, exposure);
    expoMax = Math.max(expoMax, exposure);
    if (now - expoWindowStart < 2) return;
    document.body.dataset.fxExposure = `${expoMin.toFixed(2)}-${expoMax.toFixed(2)}`;
    expoMin = expoMax = exposure;
    expoWindowStart = now;
  }

  function loop(): void {
    tickMorph();
    const now = performance.now() / 1000;
    const dt = lastFrame > 0 ? Math.min(0.25, now - lastFrame) : 1 / 60;
    lastFrame = now;

    const analyser = audio.analyser;
    if (analyser && tracker) {
      analyser.getFloatTimeDomainData(timeDomain);
      analyser.getByteFrequencyData(freqBins);
      features = tracker.update(timeDomain, freqBins, dt);
      if (onsets.update(features.onset, now)) seedOnHit(now);
    }

    const t = lfoTime();
    const eff = applyCoupling(effectiveCards(t), features, state.coupling);
    sim.reaction = reactionParamsFromCard(eff.reaction);
    sim.fieldVariation = state.visual.cards.fieldVariation.on ? fieldVariationParamsFromCard(eff.fieldVariation) : { ...ZERO_FIELD_VARIATION };
    sim.flow = state.visual.cards.flow.on ? flowParamsFromCard(eff.flow) : { ...ZERO_FLOW };
    const pal = eff.palette;
    sim.step();
    const fx = displayCoupling(features, state.coupling);
    trackExposure(fx.exposure, now);
    sim.render(
      composePalette(palettesByIndex(pal.paletteId), pal.shift, pal.contrast, pal.bands, pal.relief, pal.lightAngle, pal.gloss),
      fx,
      ripples.pack(now),
    );
    requestAnimationFrame(loop);
  }

  // --- boot ----------------------------------------------------------------
  refreshPresetList();
  // What to open: ?presetId= (cloud) > #s= (old long links) > ?preset=N >
  // the last point (localStorage) > the default preset. See state/launch.ts.
  function openFallback(url: string): void {
    const last = loadLastPoint();
    if (last) {
      loadState(last, 'restored', url);
      return;
    }
    const p = PRESETS[DEFAULT_PRESET_INDEX];
    loadState(cloneAppState(p.state), 'loaded', url);
    presetSel.value = `b:${DEFAULT_PRESET_INDEX}`;
  }

  const launch = parseLaunch(location.href);
  if (launch.kind === 'presetId') {
    const { id } = launch;
    openFallback(location.href); // something to look at while the point loads
    setStatus(`opening shared point ${id}…`);
    void fetchPoint(id, { api }).then((p) => {
      if (p) loadState(stateToAppState(p), 'opened link', withPresetId(location.href, id));
      else setStatus(`couldn't open shared point ${id} (offline, or the link is wrong)`);
      document.body.dataset.launched = '1';
    });
  } else if (launch.kind === 'token') {
    const shared = decodeStateToken(launch.token);
    if (shared) loadState(stateToAppState(shared), 'opened link');
    else openFallback(cleanUrl(location.href));
  } else if (launch.kind === 'preset' && PRESETS[launch.index]) {
    loadState(cloneAppState(PRESETS[launch.index].state), 'loaded');
    presetSel.value = `b:${launch.index}`;
  } else {
    openFallback(cleanUrl(location.href));
  }
  if (launch.kind !== 'presetId') document.body.dataset.launched = '1';
  let helpShown = false;
  try { helpShown = localStorage.getItem(HELP_SHOWN_KEY) === '1'; } catch { /* private mode */ }
  if (!helpShown) openHelp();
  requestAnimationFrame(loop);
  document.body.dataset.ready = '1'; // readiness signal for scripts/*.mjs
}

boot();
