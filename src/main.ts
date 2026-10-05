// App wiring: the two engines, the rAF loop (visual sim + LFO/coupling),
// the explorer (like / dislike / surprise / undo), morphing between points,
// presets, share links and the small HUD. Everything with logic worth
// testing lives in pure modules; this file only connects them.
import './style.css';
import { el, make } from './ui/dom';
import { renderDetails } from './ui/details';
import { SimEngine } from './sim/engine';
import { gridSize } from './sim/grid';
import { QUALITY_LADDER, QualityProbe, TOP_RUNG, backingStore } from './sim/quality';
import { CoreEngine } from './audio/coreEngine';
import { IosAudioUnlock } from './audio/iosUnlock';
import { SILENT_FEATURES } from './audio/features';
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
import { loadUserPresets, saveUserPresets, clearUserPresets } from './state/userPresets';
import { LIBRARY_KEY, loadLibrary, saveLibrary, removePoint, suggestPointName, upsertPoint } from './state/library';
import type { SavedPoint } from './state/library';
import { migrateLegacyPoints } from './state/migrate';
import { renderPointList } from './ui/pointList';
import type { PointRow } from './ui/pointList';
import { ScreenAwake, browserWakeLockEnv } from './ui/wakelock';
import {
  canvasUv, strokePoints, TOUCH_AMOUNT, TOUCH_MAX_STAMPS, TOUCH_RADIUS, TOUCH_SPACING,
} from './ui/touch';
import { askConfirm, askText } from './ui/askDialog';
import type { UserPreset } from './state/userPresets';
import { PRESETS, DEFAULT_PRESET_INDEX } from './presets';
import { SettingsPage } from './ui/settings';
import { WebSession, initCore, parseEffects, pointOf, scoutParentOf, viewOf } from './core/session';
import type { SessionView } from './core/session';
import { compileCore } from './core/audio';
import { ScoutPool } from './scout/pool';
import type { ScoutJob } from './scout/protocol';
import { samePoint } from './ui/settingsModel';

const AUDIO_PUSH_INTERVAL = 0.05; // s — how often a Settings drag re-sends the point to the sound
const HELP_SHOWN_KEY = 'synesthesia_help_shown';
// Scout (PLAN.md decision 7): offline-render + score candidates in the
// background while the user listens. `?scout=0` turns it off; `?scout=30@22050`
// renders 30 s at 22 050 Hz per candidate. Without it, the core's choice
// (syn-session ScoutConfig) — PLAN-CORE.md phase 4 measures which.
const SCOUT_PARAM = new URLSearchParams(location.search).get('scout');
const SCOUT_ENABLED = SCOUT_PARAM !== '0';
const SCOUT_CONFIG = ((): { seconds: number; sampleRate: number } => {
  const m = /^(\d+(?:\.\d+)?)@(\d+)$/.exec(SCOUT_PARAM ?? '');
  return m ? { seconds: Number(m[1]), sampleRate: Number(m[2]) } : { seconds: 0, sampleRate: 0 };
})();

const canvas = el('view', HTMLCanvasElement);
const webglError = el('webglError', HTMLParagraphElement);
const status = el('status', HTMLParagraphElement);
const details = el('details', HTMLElement);
const audioBtn = el('audioBtn', HTMLButtonElement);
const volume = el('volume', HTMLInputElement);
const pointsBtn = el('pointsBtn', HTMLButtonElement);
const pointsPanel = el('points', HTMLDivElement);
const pointsList = el('pointsList', HTMLDivElement);
const pointsCloseX = el('pointsCloseX', HTMLButtonElement);
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
const settingsBtn = el('settingsBtn', HTMLButtonElement);
const settingsSoundBtn = el('settingsSoundBtn', HTMLButtonElement);

// Slider ranges per visual card, for the LFO matrix's effectiveParams clamp.
const VISUAL_RANGES: Record<string, Record<string, readonly [number, number]>> = {};
for (const card of CARDS) VISUAL_RANGES[card.id] = cardSliderRanges(card);

function resizeCanvas(): void {
  const rect = canvas.getBoundingClientRect();
  const store = backingStore(canvasCap(), rect.width, rect.height, window.devicePixelRatio || 1);
  canvas.width = store.width;
  canvas.height = store.height;
  document.body.dataset.canvas = `${store.width}x${store.height}`;
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

// `?res=N` overrides the simulation grid (64..2048) and `?scale=N` caps the
// longest side of the canvas backing store in device pixels (0 = no cap) —
// for weak devices and for the headless scripts, where SwiftShader renders a
// few fps at 1024². Either one also switches the boot probe off, so a script
// measures the configuration it asked for and nothing else.
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

function intParam(name: string, min: number, max: number): number | undefined {
  const raw = new URLSearchParams(location.search).get(name);
  if (raw === null) return undefined;
  const v = Number(raw);
  if (!Number.isFinite(v) || v < 0) return undefined;
  return v === 0 ? 0 : Math.min(max, Math.max(min, Math.round(v)));
}

const RES_OVERRIDE = intParam('res', 64, 2048) || undefined; // 0 is not a grid
// `?paused=1`: boot everything but never start the frame loop (PLAN.md #22).
// For scripts/analyze.mjs, whose page only renders audio offline: a running
// loop kept the GPU process at ~2 cores for a picture nobody looks at.
const PAUSED = new URLSearchParams(location.search).get('paused') === '1';
// `?probe=1`: scripts/analyze.mjs --picture reads the simulation's state
// through window.synesthesiaProbe (PLAN.md #22). Absent otherwise.
const PROBE = new URLSearchParams(location.search).get('probe') === '1';

declare global {
  interface Window {
    synesthesiaProbe?: () => { width: number; height: number; v: Float32Array };
  }
}
const SCALE_OVERRIDE = intParam('scale', 64, 8192);          // 0 = uncapped, on purpose

// How big to render. Without an override, the first frames of the real loop
// pick a rung of QUALITY_LADDER and then it is fixed for the session (agreed
// with the user: measured once at boot, never moved under the viewer). The
// old test was `min(innerWidth, innerHeight) < 700` — a device test that a
// 1080p board with no GPU at all passes, and then renders at 0.4 fps.
const probe = RES_OVERRIDE === undefined && SCALE_OVERRIDE === undefined ? new QualityProbe() : null;
// Frames to let pass before the probe believes anything: shader compilation,
// the opening morph and the point load all land in the first few and none of
// them is the steady state.
const BOOT_WARMUP_FRAMES = 8;

function currentRung(): number {
  return probe ? probe.rung : TOP_RUNG;
}

function simResolution(): number {
  return RES_OVERRIDE ?? QUALITY_LADDER[currentRung()].res;
}

function canvasCap(): number {
  return SCALE_OVERRIDE ?? QUALITY_LADDER[currentRung()].maxSide;
}

async function boot(): Promise<void> {
  // The core (session, scout, sound) is wasm: instantiated before anything
  // that asks it a question.
  try {
    await initCore();
  } catch (err) {
    status.textContent = `The engine failed to load: ${err instanceof Error ? err.message : String(err)}`;
    return;
  }
  resizeCanvas();
  let sim: SimEngine;
  try {
    sim = new SimEngine({ canvas, ...gridSize(simResolution(), canvas.width, canvas.height) });
  } catch (err) {
    webglError.hidden = false;
    status.textContent = err instanceof Error ? err.message : 'WebGL2 unavailable.';
    return;
  }
  if (PROBE) window.synesthesiaProbe = () => sim.readState();
  // Canvas and grid always move together: the display pass is bound by the
  // one and every reaction substep by the other.
  function applyQuality(): void {
    resizeCanvas();
    const g = gridSize(simResolution(), canvas.width, canvas.height);
    sim.setGrid(g.width, g.height);
    document.body.dataset.grid = `${g.width}x${g.height}`;
  }
  applyQuality();
  window.addEventListener('resize', applyQuality);

  let framesSeen = 0;
  /** Feeds the boot probe one real frame time (unclamped: a 2 s frame must read as 2 s). */
  function tune(frameMs: number): void {
    if (!probe || probe.done) return;
    if (++framesSeen <= BOOT_WARMUP_FRAMES) return;
    if (probe.frame(frameMs)) applyQuality();
    if (probe.done) document.body.dataset.tuned = String(probe.rung);
  }

  const audio = new CoreEngine();
  const iosUnlock = new IosAudioUnlock();
  let features: AudioFeatures = { ...SILENT_FEATURES };
  const ripples = new RippleSet();
  let lastFrame = 0;
  // Observable effect stats for scripts/smoke.mjs (body[data-fx-hits],
  // body[data-fx-exposure] = "min-max" over the last ~2 s).
  let fxHits = 0;
  let expoMin = 1;
  let expoMax = 1;
  let expoWindowStart = 0;

  // --- the point and the session -----------------------------------------
  // What a press, a load, ⚙ Settings or the clock do is decided by the
  // core's session (PLAN-CORE.md phase 4); applyEffects() gives its effects
  // their meaning here. `state` is the point the picture draws and Settings
  // edits: mid-morph, the blend that is audible. masterGain is the volume
  // slider's, which the session also holds (it is not a gene).
  let masterGain = 0.75;
  let state: AppState = PRESETS[DEFAULT_PRESET_INDEX].state;
  const session = new WebSession(
    '', JSON.stringify(state), Math.floor(Math.random() * 2 ** 32),
    SCOUT_ENABLED, SCOUT_CONFIG.seconds, SCOUT_CONFIG.sampleRate,
  );
  let view: SessionView = viewOf(session);
  const nowS = (): number => performance.now() / 1000;

  // --- shared LFO clock ---------------------------------------------------
  // The core's engine runs its LFOs on its own sample clock from the moment
  // audio starts; the visual loop follows audio.time whenever audio runs,
  // so a route on LFO 1 breathes the same way in both.
  let clockOffset = performance.now() / 1000;
  function lfoTime(): number {
    if (audio.running) return audio.time;
    return performance.now() / 1000 - clockOffset;
  }

  function applyEffects(json: string, quiet = false): void {
    for (const e of parseEffects(json)) {
      if (quiet && e.type === 'status') continue;
      switch (e.type) {
        case 'setPoint':
          state = e.point;
          if (audio.running) audio.applyState(e.point, e.point.audio.masterGain);
          break;
        case 'switchTo':
          state = e.point;
          if (audio.running) void audio.switchTo(e.point, e.point.audio.masterGain);
          break;
        case 'reseed':
          sim.reseed();
          break;
        case 'saveLastPoint':
          saveLastPoint(e.point);
          if (!details.hidden) renderDetails(detailsBody, state, scoutParentOf(session));
          break;
        case 'startScout':
          runScout(e.job);
          break;
        case 'status':
          setStatus(e.text);
          break;
      }
    }
    refreshView();
  }

  // The session's clock: a morph a step further, a scout started once the
  // sound has settled. Independent of the frame loop, which pauses.
  setInterval(() => {
    if (!session.wantsTick()) return;
    applyEffects(session.tick(nowS()));
    // the picture morphs with or without sound (the session pushes the
    // point to the sound only while it plays)
    if (view.morphing || !audio.running) state = pointOf(session.livePointJson());
  }, 25);

  // --- UI state --------------------------------------------------------
  function setStatus(text: string): void {
    status.textContent = text;
  }

  function refreshView(): void {
    view = viewOf(session);
    undoBtn.disabled = !view.canUndo;
    setBtnText(undoBtn, view.canUndo ? `↩ Undo (${view.undoDepth})` : '↩ Undo');
    // for scripts/smoke.mjs: candidates scored, per direction
    if (view.scoutBusy || view.scoutedLike + view.scoutedDislike > 0) {
      document.body.dataset.scout = `${view.scoutedLike}/${view.scoutedDislike}`;
    } else {
      delete document.body.dataset.scout;
    }
  }

  /** The point the search is at (mid-morph: where it is heading), with the
   *  volume and, while it is still one, its name — what a save or a share takes. */
  function currentState(): AppState {
    return pointOf(session.pointJson());
  }

  // --- scout ---------------------------------------------------------------
  // The session hands out a job; the pool renders its units in Web Workers
  // (PLAN-CORE.md C4) and the result goes back to the session, which drops
  // it if the user has moved on.
  const scoutPool = new ScoutPool({ module: async () => (await compileCore()).module });

  function runScout(job: ScoutJob): void {
    // quiet: the scout works in the background and never takes the status
    // line from what the user just did (the count shows in data-scout)
    void scoutPool.run(job).then((result) => applyEffects(session.scoutFinished(JSON.stringify(result)), true));
  }

  /** Before anything that moves the point: what is still rendering is stale. */
  function stopScout(): void {
    scoutPool.cancel();
  }

  // "My points" live in the library (name + cloud id); `legacy` holds points
  // an old build stored whole, until they are uploaded (state/migrate.ts).
  let library: SavedPoint[] = loadLibrary();
  let legacy: UserPreset[] = loadUserPresets();
  let currentRef = '';

  function pointRows(): PointRow[] {
    return [
      ...library.map((p, i) => ({ ref: `u:${i}`, name: p.name, mine: true })),
      ...legacy.map((p, i) => ({ ref: `l:${i}`, name: p.name, mine: true })),
      ...PRESETS.map((p, i) => ({ ref: `b:${i}`, name: `${i}: ${p.name}`, mine: false })),
    ];
  }

  function namedPoints(): { name: string }[] {
    return [...library, ...legacy];
  }

  /** The toolbar shows what is playing; the panel is where you pick and delete. */
  function setPointRef(ref: string): void {
    currentRef = ref;
    const row = pointRows().find((r) => r.ref === ref);
    // Plain text, not setBtnText: a phone hides the .lbl half of a button,
    // and the point's name is the one thing that has to stay readable.
    pointsBtn.textContent = row ? `${row.mine ? '💾 ' : ''}${row.name}` : '— point —';
    if (!pointsPanel.hidden) renderPoints();
  }

  function renderPoints(): void {
    renderPointList(pointsList, pointRows(), currentRef, { onPick: openPoint, onDelete: deletePoint });
  }

  function openPoints(): void {
    renderPoints();
    pointsPanel.hidden = false;
  }

  function closePoints(): void {
    pointsPanel.hidden = true;
  }

  pointsBtn.addEventListener('click', () => { if (pointsPanel.hidden) openPoints(); else closePoints(); });
  pointsCloseX.addEventListener('click', closePoints);
  pointsPanel.addEventListener('click', (e) => { if (e.target === pointsPanel) closePoints(); });

  function openPoint(ref: string): void {
    closePoints();
    const index = Number(ref.slice(2));
    if (ref.startsWith('b:')) {
      const p = PRESETS[index];
      if (!p) return;
      loadState(cloneAppState(p.state), 'loaded');
      setPointRef(ref);
    } else if (ref.startsWith('l:')) {
      const p = legacy[index];
      if (!p) return;
      loadState(cloneAppState(p.state), 'loaded');
      setPointRef(ref);
    } else {
      const p = library[index];
      if (!p) return;
      setStatus(`opening “${p.name}”…`);
      void fetchPoint(p.id, { api }).then((loaded) => {
        if (!loaded) {
          setStatus(`couldn't open “${p.name}” — the points server is unreachable; try again in a moment`);
          return;
        }
        loadState(stateToAppState(loaded), 'loaded');
        setPointRef(ref);
      });
    }
  }

  async function deletePoint(ref: string): Promise<void> {
    const index = Number(ref.slice(2));
    const row = pointRows().find((r) => r.ref === ref);
    if (!row) return;
    const ok = await askConfirm({
      title: `Delete “${row.name}”?`,
      detail: 'It goes from your list here. The point keeps playing, and any link you shared for it keeps working.',
      ok: '🗑 Delete',
    });
    if (!ok) return;
    let result;
    if (ref.startsWith('u:')) {
      result = saveLibrary(removePoint(loadLibrary(), index));
      library = loadLibrary();
    } else {
      result = saveUserPresets(legacy.filter((_, i) => i !== index));
      legacy = loadUserPresets();
    }
    if (currentRef === ref) setPointRef('');
    renderPoints();
    setStatus(result.ok
      ? `deleted “${row.name}” — the point itself is still playing`
      : storageProblem(`couldn't delete “${row.name}”`, result.reason));
  }

  // --- actions -----------------------------------------------------------
  /** A press moves the point away from whatever was loaded: the link that
   *  named it no longer does, and what the scout was rendering is stale. */
  function stepAway(): void {
    stopScout();
    history.replaceState(null, '', cleanUrl(location.href));
    setPointRef('');
  }

  function like(): void {
    stepAway();
    applyEffects(session.like(nowS()));
    flash(likeBtn, '👍 Liked');
  }

  function dislike(): void {
    stepAway();
    applyEffects(session.dislike(nowS()));
    flash(dislikeBtn, '👎 Noted');
  }

  function surprise(): void {
    stepAway();
    applyEffects(session.surprise(nowS()));
    flash(surpriseBtn, `🎲 ${view.pointName}`); // "near <preset>"
  }

  function undo(): void {
    if (!view.canUndo) return;
    stepAway();
    applyEffects(session.undo(nowS()));
  }

  /** Load a whole point (preset / link): fresh search, a hard switch, image reseeded. */
  function loadState(s: AppState, label: string, url: string = cleanUrl(location.href)): void {
    history.replaceState(null, '', url);
    stopScout();
    masterGain = s.audio.masterGain;
    volume.value = String(masterGain);
    applyEffects(session.load(nowS(), '', JSON.stringify(s)));
    setStatus(`${label}: ${s.presetName ?? 'unnamed point'}`);
  }

  // Phones dim the screen while you watch: take a wake lock on the first
  // gesture (that's when browsers grant it); ui/wakelock.ts takes it again
  // whenever the page comes back (screen unlocked, app switched back) or,
  // failing that, on the next touch.
  const screenAwake = new ScreenAwake(browserWakeLockEnv(), (on) => {
    document.body.dataset.awake = on ? '1' : '0';
  });
  const stayAwake = (): void => { void screenAwake.keep(); };
  for (const ev of ['pointerdown', 'keydown']) {
    document.addEventListener(ev, stayAwake, { once: true });
  }

  // iOS suspends the audio context when the tab goes away (a call, an app
  // switch, the screen locking) and does not always bring it back on its
  // own: the button still says it is playing and nothing is heard.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && audio.running) void audio.resume();
  });

  likeBtn.addEventListener('click', like);
  dislikeBtn.addEventListener('click', dislike);
  surpriseBtn.addEventListener('click', surprise);
  undoBtn.addEventListener('click', undo);
  reseedBtn.addEventListener('click', () => {
    sim.reseed();
    flash(reseedBtn, '🌱 Reseeded');
  });

  /** Why a save didn't happen, in words a user can act on. */
  function storageProblem(what: string, reason: 'full' | 'blocked'): string {
    return reason === 'full'
      ? `${what} — this browser's storage is full (it is shared with every app on this site); delete a point (🗑) and try again`
      : `${what} — this browser isn't storing data for the site (private mode, or site data blocked); use 🔗 Share to keep the point`;
  }

  // 💾 Save: the point goes to the points database (like 🔗 Share does) and
  // only its name and id stay here — a whole point is 4.4 KB against ~37
  // bytes, and the browser's storage is shared with every app on the origin
  // (PLAN.md decision 10).
  saveBtn.addEventListener('click', () => { void saveCurrentPoint(); });
  async function saveCurrentPoint(): Promise<void> {
    const suggested = suggestPointName(currentState().presetName, namedPoints());
    const name = await askText({ title: 'Name this point', value: suggested, ok: '💾 Save' });
    if (name === null) return;
    const s = currentState();
    s.presetName = name.trim() || suggested;
    setStatus(`saving “${s.presetName}”…`);
    saveBtn.disabled = true;
    let id: string;
    try {
      id = await sharePoint(s, { api });
    } catch {
      setStatus(`couldn't save “${s.presetName}” — the points server is unreachable; try again in a moment`);
      return;
    } finally {
      saveBtn.disabled = false;
    }
    // The point is the user's own named one now (and saved as the last point).
    applyEffects(session.keptAs(s.presetName));
    // Re-read before writing: another tab may have saved points since this
    // one loaded, and writing our own list back would drop them.
    const result = saveLibrary(upsertPoint(loadLibrary(), { id, name: s.presetName }));
    library = loadLibrary();
    if (!result.ok) {
      // The point itself is safe on the server, so hand over its link.
      setStatus(`${storageProblem(`couldn't add “${s.presetName}” to your points`, result.reason)}. It is stored, though: ${withPresetId(location.href, id)}`);
      return;
    }
    setPointRef(`u:${library.findIndex((p) => p.name === s.presetName)}`);
    flash(saveBtn, '💾 Saved');
    setStatus(`saved as “${s.presetName}” — it's in the points list, under “My points”`);
  }

  // Another tab saved or deleted a point: show the same list here.
  window.addEventListener('storage', (e) => {
    if (e.key !== null && e.key !== LIBRARY_KEY) return;
    library = loadLibrary();
    setPointRef(currentRef);
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
        await askText({ title: 'Copy this link', value: url, ok: 'Done' });
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
    if (!details.hidden) renderDetails(detailsBody, state, scoutParentOf(session));
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

  // --- ⚙ Settings --------------------------------------------------------
  // A full-screen page with every parameter of the point (ui/settings.ts).
  // It edits a copy of the point, which is also `state` while it is open:
  // sound changes go to the engine at once, the frame loop stops (so the
  // picture shows its changes on close), and closing commits the point as
  // one undoable step — a jump, not a morph: the sound is already there.
  const settings = new SettingsPage({
    root: el('settings', HTMLElement),
    tabAudio: el('tabAudio', HTMLButtonElement),
    tabVideo: el('tabVideo', HTMLButtonElement),
    paneAudio: el('paneAudio', HTMLDivElement),
    paneVideo: el('paneVideo', HTMLDivElement),
    closeBtn: el('settingsCloseBtn', HTMLButtonElement),
    soundBtn: settingsSoundBtn,
  }, {
    onSound: pushSettingsSound,
    onVolume: (v) => {
      // While Settings is open the sound plays the point being edited; the
      // session takes the volume with that point when the page closes.
      masterGain = v;
      volume.value = String(v);
      audio.setMasterGain(v);
    },
    onSoundToggle: () => {
      if (audio.running) void stopAudio();
      else void startAudio();
    },
    onClose: closeSettings,
  });

  // A slider drag fires far more often than the engine needs: at most one
  // push per AUDIO_PUSH_INTERVAL (as a morph does), and always the last one.
  let soundEditTimer: ReturnType<typeof setTimeout> | null = null;
  let soundEditAt = -Infinity;
  let soundEdits = 0;
  function flushSettingsSound(): void {
    if (soundEditTimer !== null) clearTimeout(soundEditTimer);
    soundEditTimer = null;
    soundEditAt = performance.now();
    if (!audio.running) return;
    audio.applyState(state, masterGain);
    document.body.dataset.soundEdits = String(++soundEdits); // for scripts/smoke.mjs
  }
  function pushSettingsSound(): void {
    const wait = AUDIO_PUSH_INTERVAL * 1000 - (performance.now() - soundEditAt);
    if (wait <= 0) flushSettingsSound();
    else if (soundEditTimer === null) soundEditTimer = setTimeout(flushSettingsSound, wait);
  }

  function openSettings(): void {
    if (settings.isOpen) return;
    // The session lands a morph in flight (the page edits the point it was
    // heading to) and stops the scout (its candidates are about the point
    // being edited away).
    stopScout();
    applyEffects(session.openSettings(nowS()));
    endStroke();
    state = currentState();
    settings.open(state, masterGain, audio.running);
    document.body.dataset.settings = 'open';
  }

  function closeSettings(): void {
    if (!settings.isOpen) return;
    if (soundEditTimer !== null) flushSettingsSound();
    settings.hide();
    delete document.body.dataset.settings;
    settingsBtn.focus();
    const before = currentState();
    const edited = !samePoint(state, before);
    // One undoable step and a jump, not a morph — the sound is already there;
    // no change at all only settles what opening landed.
    const point: AppState = { ...state, audio: { ...state.audio, masterGain } };
    if (edited) {
      history.replaceState(null, '', cleanUrl(location.href));
      setPointRef('');
    } else {
      state = before;
    }
    applyEffects(session.closeSettings(nowS(), JSON.stringify(point)));
    resumeLoop();
  }

  settingsBtn.addEventListener('click', openSettings);

  // --- audio -------------------------------------------------------------
  function showSound(running: boolean): void {
    for (const b of [audioBtn, settingsSoundBtn]) {
      setBtnText(b, running ? '⏹ Sound' : '▶ Sound');
      b.classList.toggle('running', running);
    }
    settings.setSoundRunning(running);
  }

  function soundBusy(busy: boolean): void {
    audioBtn.disabled = busy;
    settingsSoundBtn.disabled = busy;
  }

  async function startAudio(): Promise<void> {
    if (audio.running) return;
    // iOS: the silent <audio> has to start SYNCHRONOUSLY inside the gesture,
    // before the first await, or the Ring/Silent switch mutes everything.
    // See audio/iosUnlock.ts — this must stay the first statement here.
    // (body[data-ios-unlock] is how scripts/smoke.mjs sees it happened.)
    void iosUnlock.play().then((ok) => { document.body.dataset.iosUnlock = ok ? '1' : 'refused'; });
    soundBusy(true);
    try {
      await audio.start(state, masterGain);
    } catch (err) {
      setStatus(`audio failed: ${err instanceof Error ? err.message : String(err)}`);
      soundBusy(false);
      return;
    }
    soundBusy(false);
    showSound(true);
    applyEffects(session.setPlaying(nowS(), true));
  }

  async function stopAudio(): Promise<void> {
    if (!audio.running) return;
    iosUnlock.stop();
    document.body.dataset.iosUnlock = '0';
    clockOffset = performance.now() / 1000 - audio.time; // keep the LFO clock continuous
    stopScout();
    applyEffects(session.setPlaying(nowS(), false));
    await audio.stop();
    features = { ...SILENT_FEATURES };
    showSound(false);
  }

  audioBtn.addEventListener('click', () => {
    if (audio.running) void stopAudio();
    else void startAudio();
  });

  volume.addEventListener('input', () => {
    masterGain = Number(volume.value);
    applyEffects(session.setMasterGain(nowS(), masterGain));
  });

  document.addEventListener('keydown', (e) => {
    // The settings page owns the keyboard: its sliders take the arrows, and
    // no 👍/👎 may fire behind it.
    if (settings.isOpen) {
      if (e.key === 'Escape') { e.preventDefault(); closeSettings(); }
      return;
    }
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
    if (!helpBox.hidden) { if (e.key === 'Escape' || e.key === 'Enter') closeHelp(); return; }
    if (!pointsPanel.hidden) { if (e.key === 'Escape') closePoints(); return; }
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

  // --- touch / click on the canvas (PLAN.md decision 14) -----------------
  // A finger seeds the picture exactly the way a bell strike does: the same
  // inject() disc and the same ripple as an onset hit. Sampled once per
  // frame, not per pointermove — a move event can fire at 120 Hz and each
  // stamp is a full-grid pass.
  let painting = false;
  let pointerUv: [number, number] = [0.5, 0.5];
  let stampedAt: [number, number] | null = null;
  let touchSeeds = 0;

  function paintStroke(): void {
    if (!painting) return;
    const points = stampedAt
      ? strokePoints(stampedAt, pointerUv, TOUCH_SPACING, sim.aspect, TOUCH_MAX_STAMPS)
      : [pointerUv];
    for (const p of points) sim.inject(p, TOUCH_RADIUS, TOUCH_AMOUNT);
    stampedAt = [pointerUv[0], pointerUv[1]];
    touchSeeds += points.length;
    document.body.dataset.touchSeeds = String(touchSeeds);
  }

  canvas.addEventListener('pointerdown', (e) => {
    painting = true;
    stampedAt = null; // a press stamps exactly where it landed, with no trail
    pointerUv = canvasUv(canvas.getBoundingClientRect(), e.clientX, e.clientY);
    ripples.add(pointerUv[0], pointerUv[1], TOUCH_AMOUNT, performance.now() / 1000);
    canvas.setPointerCapture(e.pointerId);
    e.preventDefault(); // no text selection, no scroll-from-canvas on a phone
  });
  canvas.addEventListener('pointermove', (e) => {
    if (painting) pointerUv = canvasUv(canvas.getBoundingClientRect(), e.clientX, e.clientY);
  });
  const endStroke = (): void => {
    painting = false;
    stampedAt = null;
  };
  canvas.addEventListener('pointerup', endStroke);
  canvas.addEventListener('pointercancel', endStroke);

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

  // The loop stops itself while ⚙ Settings is open (the picture is paused
  // there by design, PLAN.md #28); resumeLoop() starts it again.
  let loopRunning = false;
  function resumeLoop(): void {
    if (PAUSED || loopRunning) return;
    loopRunning = true;
    lastFrame = 0;
    document.body.dataset.loop = 'running';
    requestAnimationFrame(loop);
  }

  function loop(): void {
    if (settings.isOpen) {
      loopRunning = false;
      document.body.dataset.loop = 'paused';
      return;
    }
    const now = performance.now() / 1000;
    const since = lastFrame > 0 ? now - lastFrame : 0;
    // the first frame after a start or a pause has no interval to measure
    if (lastFrame > 0) tune(since * 1000);
    lastFrame = now;

    // The core analyses its own sound (features, onset hits) and posts a
    // frame every ~21 ms; this reads the one being heard now.
    if (audio.running) {
      features = audio.features() ?? features;
      if (audio.hitHeard()) seedOnHit(now);
    }

    paintStroke();
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
    // While the probe is choosing: make the next frame interval mean "this
    // frame was drawn", not "this frame was queued". Never after that — it
    // costs a swap-chain resolve every frame.
    if (probe && !probe.done) sim.syncFrame();
    requestAnimationFrame(loop);
  }

  // --- boot ----------------------------------------------------------------
  setPointRef('');
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
    setPointRef(`b:${DEFAULT_PRESET_INDEX}`);
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
    setPointRef(`b:${launch.index}`);
  } else {
    openFallback(cleanUrl(location.href));
  }
  if (launch.kind !== 'presetId') document.body.dataset.launched = '1';

  // Points an old build stored whole (4.4 KB each) move to the library and
  // the old key is dropped, which is also what frees the storage a user with
  // a full quota is stuck on. Anything that can't be uploaded stays put and
  // is retried next time.
  if (legacy.length > 0) {
    void migrateLegacyPoints({
      upload: (st) => sharePoint(st, { api }),
      readLibrary: loadLibrary,
      writeLibrary: saveLibrary,
      readLegacy: loadUserPresets,
      writeLegacy: saveUserPresets,
      clearLegacy: clearUserPresets,
    }).then((res) => {
      library = res.library;
      legacy = res.legacy;
      setPointRef(currentRef);
      document.body.dataset.migrated = `${res.moved}/${res.stored ? 'stored' : 'memory'}`;
    });
  }
  let helpShown = false;
  try { helpShown = localStorage.getItem(HELP_SHOWN_KEY) === '1'; } catch { /* private mode */ }
  if (!helpShown) openHelp();
  if (PAUSED) document.body.dataset.paused = '1';
  else resumeLoop();
  document.body.dataset.ready = '1'; // readiness signal for scripts/*.mjs
}

void boot();
