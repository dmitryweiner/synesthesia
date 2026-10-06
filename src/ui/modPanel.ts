// Modulation in ⚙ Settings (ported from the siblings' ModMatrix): the pool
// of LFOs and the routes "LFO → target.param → depth". The pool is shared
// by sound and picture, so both tabs show it; each tab lists only the routes
// of its own side. Unlike the siblings the DOM is not the source of truth —
// the widgets write straight into the point's ModState and sync() redraws
// them, since both tabs edit the same LFOs.
import type { AppState } from '../state/schema';
import type { ModRoute } from '../dsp/mod';
import { isLfoShape } from '../dsp/mod';
import { make } from './dom';
import { card, fillSelect, selectRow, sliderRow } from './controls';
import type { ChoiceOption } from './controls';
import type { Domain } from './settingsModel';
import {
  FX_TARGET, canAddRoute, coreSchema, formatValue, isTargetOn, lfoPhaseScale, lfoRateScale, lfoShapeLabels,
  newRoute, routeDepthScale, routeDomain, targetExp, targetGroups,
} from './settingsModel';

export interface ModPanelOptions {
  domain: Domain;
  /** Prefix for element ids, unique per panel. */
  id: string;
  state(): AppState;
  /** kind 'lfo': a shared LFO changed (heard and seen); 'route': one of this side's routes. */
  onChange(kind: 'lfo' | 'route'): void;
}

function shapeOptions(): ChoiceOption[] {
  const labels = lfoShapeLabels();
  return coreSchema().lfoShapes.map((s) => ({ value: s, label: labels[s] ?? s }));
}

export class ModPanel {
  readonly root: HTMLElement;
  private readonly lfoSyncs: (() => void)[] = [];
  private readonly routesHost: HTMLElement;
  private readonly addBtn: HTMLButtonElement;
  private readonly opts: ModPanelOptions;

  constructor(opts: ModPanelOptions) {
    this.opts = opts;
    this.root = make('div', 'settings-grid');

    const lfoCard = card({
      id: `${opts.id}_lfos`,
      title: 'LFOs',
      tag: 'shared by sound and picture',
      desc: 'Slow oscillators. One LFO can move a sound parameter and a picture parameter at once — that is how they breathe together.',
    });
    for (let i = 0; i < coreSchema().lfoCount; i++) this.buildLfo(lfoCard.body, i);
    this.root.appendChild(lfoCard.root);

    const routesCard = card({
      id: `${opts.id}_routes`,
      title: opts.domain === 'sound' ? 'Routes → sound' : 'Routes → picture',
      tag: `${coreSchema().routeSlots} at most, both sides together`,
      desc: opts.domain === 'sound'
        ? 'Which LFO moves which sound parameter, and how far (± a share of its range; “oct” moves it in octaves).'
        : 'Which LFO moves which picture parameter, and how far (± a share of its range).',
    });
    this.routesHost = make('div', 'mod-routes');
    this.addBtn = make('button', 'mini-btn', '+ add route');
    this.addBtn.type = 'button';
    this.addBtn.id = `${opts.id}_add`;
    this.addBtn.addEventListener('click', () => {
      const s = this.opts.state();
      if (!canAddRoute(s)) return;
      s.mod.routes.push(newRoute(s, this.opts.domain));
      this.opts.onChange('route');
      this.sync();
    });
    routesCard.body.append(this.routesHost, this.addBtn);
    this.root.appendChild(routesCard.root);
  }

  /** Redraw from the state: LFO values, this side's routes, the route cap. */
  sync(): void {
    for (const s of this.lfoSyncs) s();
    this.routesHost.replaceChildren();
    const s = this.opts.state();
    const mine = s.mod.routes.filter((r) => routeDomain(r.target) === this.opts.domain);
    if (mine.length === 0) this.routesHost.appendChild(make('p', 'settings-empty', 'No routes on this side yet.'));
    mine.forEach((r, i) => this.routesHost.appendChild(this.routeRow(r, i)));
    const full = !canAddRoute(s);
    this.addBtn.disabled = full;
    this.addBtn.title = full ? `${coreSchema().routeSlots} routes at most — sound and picture together. Remove one first.` : '';
  }

  private buildLfo(host: HTMLElement, i: number): void {
    const lfo = () => this.opts.state().mod.lfos[i];
    const box = make('div', 'mod-lfo');
    box.appendChild(make('div', 'mod-lfo-name', `LFO ${i + 1}`));
    const shape = selectRow({
      id: `${this.opts.id}_lfo${i}_shape`,
      label: 'Shape',
      options: shapeOptions(),
      get: () => lfo().shape,
      set: (v) => {
        if (isLfoShape(v)) lfo().shape = v;
        this.opts.onChange('lfo');
      },
    });
    const rate = sliderRow({
      id: `${this.opts.id}_lfo${i}_rate`,
      label: 'Rate (cycle)',
      scale: lfoRateScale(),
      get: () => lfo().rate,
      set: (v) => { lfo().rate = v; this.opts.onChange('lfo'); },
      // at 0.003–2 Hz one full cycle (5.5 min … 0.5 s) says more than the rate
      format: (v) => `${formatValue(1 / v)} s`,
    });
    const phase = sliderRow({
      id: `${this.opts.id}_lfo${i}_phase`,
      label: 'Phase',
      scale: lfoPhaseScale(),
      get: () => lfo().phase,
      set: (v) => { lfo().phase = v; this.opts.onChange('lfo'); },
    });
    box.append(shape.row, rate.row, phase.row);
    host.appendChild(box);
    this.lfoSyncs.push(shape.sync, rate.sync, phase.sync);
  }

  /** Targets a route may pick: what is on, plus its own current target even if that is off. */
  private targetOptions(current: string): ChoiceOption[] {
    const s = this.opts.state();
    return targetGroups(this.opts.domain)
      .filter((g) => g.id === current || isTargetOn(s, g.id))
      .map((g) => ({
        value: g.id,
        label: isTargetOn(s, g.id) ? g.title : `${g.title} (off)`,
        group: g.id === FX_TARGET ? 'Effects' : undefined,
      }));
  }

  private paramOptions(target: string): ChoiceOption[] {
    const g = targetGroups(this.opts.domain).find((x) => x.id === target);
    return (g?.params ?? []).map((p) => ({ value: p.k, label: p.name }));
  }

  private routeRow(route: ModRoute, n: number): HTMLElement {
    const id = `${this.opts.id}_r${n}`;
    const row = make('div', 'mod-route');
    const head = make('div', 'mod-route-head');
    const src = make('select');
    src.id = `${id}_src`;
    src.setAttribute('aria-label', 'LFO');
    fillSelect(src, Array.from({ length: coreSchema().lfoCount }, (_, i) => ({ value: String(i), label: `LFO ${i + 1}` })));
    src.value = String(route.src);
    const target = make('select');
    target.id = `${id}_target`;
    target.setAttribute('aria-label', 'Target');
    fillSelect(target, this.targetOptions(route.target));
    target.value = route.target;
    const param = make('select');
    param.id = `${id}_param`;
    param.setAttribute('aria-label', 'Parameter');
    fillSelect(param, this.paramOptions(route.target));
    param.value = route.param;
    const del = make('button', 'mini-btn mod-del', '✕');
    del.type = 'button';
    del.title = 'Remove this route';
    del.setAttribute('aria-label', 'Remove this route');
    head.append(src, make('span', 'mod-arrow', '→'), target, param, del);

    const depth = sliderRow({
      id: `${id}_depth`,
      label: 'Depth',
      scale: routeDepthScale(),
      get: () => route.depth,
      set: (v) => { route.depth = v; this.opts.onChange('route'); },
      format: (v) => `${v >= 0 ? '+' : ''}${v.toFixed(2)}`,
    });
    const expLab = make('label', 'mod-exp');
    const exp = make('input');
    exp.type = 'checkbox';
    exp.id = `${id}_exp`;
    exp.checked = route.exp === true;
    expLab.title = 'Move the parameter in octaves (for frequencies)';
    expLab.append(exp, ' oct');
    depth.row.appendChild(expLab);
    depth.row.classList.add('with-exp');
    depth.sync();

    const setExp = (on: boolean): void => {
      if (on) route.exp = true;
      else delete route.exp;
      exp.checked = on;
    };
    src.addEventListener('change', () => { route.src = Number(src.value); this.opts.onChange('route'); });
    target.addEventListener('change', () => {
      route.target = target.value;
      const first = this.paramOptions(route.target)[0];
      route.param = first ? first.value : '';
      setExp(targetExp(route.target, route.param));
      this.opts.onChange('route');
      this.sync(); // drops a stale "(off)" target, refills the params
    });
    param.addEventListener('change', () => {
      route.param = param.value;
      setExp(targetExp(route.target, route.param));
      this.opts.onChange('route');
    });
    exp.addEventListener('change', () => { setExp(exp.checked); this.opts.onChange('route'); });
    del.addEventListener('click', () => {
      const routes = this.opts.state().mod.routes;
      const i = routes.indexOf(route);
      if (i >= 0) routes.splice(i, 1);
      this.opts.onChange('route');
      this.sync();
    });

    row.append(head, depth.row);
    return row;
  }
}
