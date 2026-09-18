// AudioWorklet wrapper over the pure DSP core. Separate entry that Vite
// bundles as a self-contained module (see engine.ts: ?worker&url).
import { FormulaGenerator, isFormulaId, DEFAULT_PARAMS } from '../dsp/generator';
import type { FormulaId, Params } from '../dsp/generator';
import type { LfoDef, LfoShape, ModRoute, ParamRanges } from '../dsp/mod';
import { applyGate, gateIsSilent } from '../dsp/gate';

function toParams(v: unknown): Params {
  const out: Params = {};
  if (typeof v === 'object' && v !== null) {
    for (const [k, val] of Object.entries(v)) {
      if (typeof val === 'number') out[k] = val;
    }
  }
  return out;
}

function toFormulaId(v: unknown): FormulaId {
  return typeof v === 'string' && isFormulaId(v) ? v : 'fm';
}

// Tolerant parse of the modulation payload (engine sends it, but onmessage
// sees unknown — narrowed without casts). Local so the worklet stays
// self-contained.
const LFO_SHAPES: ReadonlySet<string> = new Set(['sine', 'triangle', 'saw', 'square', 'random']);
function isRecord(u: unknown): u is Record<string, unknown> {
  return typeof u === 'object' && u !== null;
}
function isLfoShape(v: unknown): v is LfoShape {
  return typeof v === 'string' && LFO_SHAPES.has(v);
}
function toArray(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

function toLfos(v: unknown): LfoDef[] {
  const out: LfoDef[] = [];
  for (const item of toArray(v)) {
    if (!isRecord(item)) continue;
    const { shape, rate, phase } = item;
    if (isLfoShape(shape) && typeof rate === 'number' && typeof phase === 'number') {
      out.push({ shape, rate, phase });
    }
  }
  return out;
}

function toRoutes(v: unknown): ModRoute[] {
  const out: ModRoute[] = [];
  for (const item of toArray(v)) {
    if (!isRecord(item)) continue;
    const { src, target, param, depth, exp } = item;
    if (typeof src === 'number' && typeof target === 'string'
      && typeof param === 'string' && typeof depth === 'number') {
      const route: ModRoute = { src, target, param, depth };
      if (typeof exp === 'boolean') route.exp = exp;
      out.push(route);
    }
  }
  return out;
}

function toRanges(v: unknown): ParamRanges {
  const out: ParamRanges = {};
  if (!isRecord(v)) return out;
  for (const [k, val] of Object.entries(v)) {
    if (Array.isArray(val) && val.length === 2 && typeof val[0] === 'number' && typeof val[1] === 'number') {
      out[k] = [val[0], val[1]];
    }
  }
  return out;
}

function applyMod(gen: FormulaGenerator, src: unknown): void {
  if (!isRecord(src)) return;
  gen.setMod(toLfos(src.lfos), toRoutes(src.routes), toRanges(src.ranges));
}

class FormulaGeneratorProcessor extends AudioWorkletProcessor {
  private gen: FormulaGenerator;
  private enabled: boolean;
  private fade: number;

  constructor(options?: { processorOptions?: unknown }) {
    super();
    const o: unknown = options?.processorOptions;
    let formula: FormulaId = 'fm';
    let params: Params = { ...DEFAULT_PARAMS };
    let enabled = false;
    if (typeof o === 'object' && o !== null) {
      const rec: Record<string, unknown> = { ...o };
      formula = toFormulaId(rec.formula);
      params = toParams(rec.params);
      enabled = rec.enabled === true;
    }
    this.gen = new FormulaGenerator(formula, sampleRate, params);
    this.enabled = enabled;
    this.fade = enabled ? 1 : 0;
    if (typeof o === 'object' && o !== null) {
      const rec: Record<string, unknown> = { ...o };
      applyMod(this.gen, rec.mod);
    }

    this.port.onmessage = (e: MessageEvent) => {
      const msg: unknown = e.data;
      if (typeof msg !== 'object' || msg === null) return;
      const rec: Record<string, unknown> = { ...msg };
      if (rec.type === 'set') {
        this.gen.set(toParams(rec.params));
      } else if (rec.type === 'reset') {
        this.gen.reset();
      } else if (rec.type === 'enabled') {
        this.enabled = rec.enabled === true;
      } else if (rec.type === 'mod') {
        applyMod(this.gen, rec);
      }
    };
  }

  process(_inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
    // A disabled generator stops computing after its fade-out (audio-thread CPU).
    if (gateIsSilent(this.fade, this.enabled)) return true;
    const out = outputs[0][0];
    this.gen.fill(out);
    this.fade = applyGate(out, this.fade, this.enabled);
    return true;
  }
}

registerProcessor('formula-generator', FormulaGeneratorProcessor);
