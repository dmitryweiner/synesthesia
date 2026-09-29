// Widgets of the ⚙ Settings page: a card (checkbox, title, tag, collapsible
// body — chromaflux's and formula-synth's cards are the same idea), a slider
// row with −/+ (ui/adjust.ts), a select row. Each widget reads and writes
// the value through get/set, so it never holds a copy of the state, and
// sync() draws it from the state — the page builds its widgets before any
// point is open, so nothing reads the state until the first sync().
import { make } from './dom';
import type { Scale } from './settingsModel';
import { formatValue, fromSliderPos, rangeAttrs, toSliderPos } from './settingsModel';

export interface SliderOptions {
  id: string;
  label: string;
  scale: Scale;
  get(): number;
  set(v: number): void;
  format?(v: number): string;
  /** `target.param` — the row gets a ∿ while an LFO route moves it. */
  modKey?: string;
}

export interface SliderRow {
  row: HTMLElement;
  sync(): void;
  setLabel(text: string): void;
}

export function sliderRow(o: SliderOptions): SliderRow {
  const row = make('div', 'ctrl');
  if (o.modKey) row.dataset.mod = o.modKey;
  const label = make('label', undefined, o.label);
  label.htmlFor = o.id;
  const input = make('input');
  input.type = 'range';
  input.id = o.id;
  const r = rangeAttrs(o.scale);
  input.min = String(r.min);
  input.max = String(r.max);
  input.step = String(r.step);
  const out = make('output');
  out.htmlFor.add(o.id);
  const format = o.format ?? ((v: number) => formatValue(v, o.scale.step));
  const adj = (dir: 1 | -1): HTMLButtonElement => {
    const b = make('button', 'adj-btn', dir < 0 ? '−' : '+');
    b.type = 'button';
    b.tabIndex = -1; // the slider itself takes arrow keys; two more tab stops per row is noise
    b.dataset.slider = o.id;
    b.dataset.dir = String(dir);
    b.setAttribute('aria-label', `${dir < 0 ? 'Decrease' : 'Increase'} ${o.label}`);
    return b;
  };
  input.addEventListener('input', () => {
    const v = fromSliderPos(o.scale, Number(input.value));
    o.set(v);
    out.value = format(v);
  });
  row.append(label, adj(-1), input, adj(1), out);
  const sync = (): void => {
    const v = o.get();
    input.value = String(toSliderPos(o.scale, v));
    out.value = format(v);
  };
  return { row, sync, setLabel: (text) => { label.textContent = text; } };
}

export interface ChoiceOption {
  value: string;
  label: string;
  group?: string;
}

export interface SelectOptions {
  id: string;
  label: string;
  options: readonly ChoiceOption[];
  get(): string;
  set(v: string): void;
}

export function fillSelect(select: HTMLSelectElement, options: readonly ChoiceOption[]): void {
  select.replaceChildren();
  const groups = new Map<string, HTMLOptGroupElement>();
  for (const o of options) {
    const opt = make('option', undefined, o.label);
    opt.value = o.value;
    if (!o.group) {
      select.appendChild(opt);
      continue;
    }
    let g = groups.get(o.group);
    if (!g) {
      g = make('optgroup');
      g.label = o.group;
      groups.set(o.group, g);
      select.appendChild(g);
    }
    g.appendChild(opt);
  }
}

export function selectRow(o: SelectOptions): { row: HTMLElement; select: HTMLSelectElement; sync(): void } {
  const row = make('div', 'ctrl ctrl-select');
  const label = make('label', undefined, o.label);
  label.htmlFor = o.id;
  const select = make('select');
  select.id = o.id;
  fillSelect(select, o.options);
  select.addEventListener('change', () => o.set(select.value));
  row.append(label, select);
  const sync = (): void => { select.value = o.get(); };
  return { row, select, sync };
}

export interface CardOptions {
  id: string;
  title: string;
  tag?: string;
  desc?: string;
  /** Absent: the card is always on (Reaction, Palette, the couplings). */
  toggle?: {
    get(): boolean;
    set(on: boolean): void;
    /** Whether switching it on is allowed now (the 5-formula cap). */
    allowed?(): boolean;
    blockedTitle?: string;
  };
}

export interface Card {
  root: HTMLElement;
  body: HTMLElement;
  /** Checkbox, highlight, cap — and a switchable card opens exactly when it is on. */
  sync(): void;
  /** Checkbox, highlight and cap only; leaves open/closed as the user left it. */
  refresh(): void;
  setOpen(open: boolean): void;
}

export function card(o: CardOptions): Card {
  const root = make('div', 'fcard');
  root.id = o.id;
  const head = make('div', 'fcard-head');
  const check = make('input');
  check.type = 'checkbox';
  check.id = `${o.id}_on`;
  check.setAttribute('aria-label', `${o.title} on`);
  if (o.toggle) head.appendChild(check);
  head.appendChild(make('span', 'fcard-title', o.title));
  if (o.tag) head.appendChild(make('span', 'fcard-tag', o.tag));
  const caret = make('span', 'fcard-caret');
  head.appendChild(caret);
  const body = make('div', 'fcard-body');
  if (o.desc) body.appendChild(make('div', 'fcard-desc', o.desc));
  root.append(head, body);

  const setOpen = (open: boolean): void => {
    root.classList.toggle('collapsed', !open);
    caret.textContent = open ? '▾' : '▸';
    head.setAttribute('aria-expanded', String(open));
  };
  const refresh = (): void => {
    if (!o.toggle) return;
    const on = o.toggle.get();
    check.checked = on;
    root.classList.toggle('active', on);
    const blocked = !on && o.toggle.allowed !== undefined && !o.toggle.allowed();
    check.disabled = blocked;
    check.title = blocked ? (o.toggle.blockedTitle ?? '') : '';
  };

  head.addEventListener('click', (e) => {
    if (e.target === check) return;
    setOpen(root.classList.contains('collapsed'));
  });
  check.addEventListener('change', () => {
    o.toggle?.set(check.checked);
    setOpen(check.checked);
    refresh();
  });

  const sync = (): void => {
    refresh();
    if (o.toggle) setOpen(o.toggle.get());
  };
  setOpen(!o.toggle);
  return { root, body, sync, refresh, setOpen };
}
