// The points list: your saved points and the built-in presets.
//
// A native <select> can't do this — a phone renders its options as a system
// sheet, with no room for a 🗑 next to a row, so deleting a point was
// nowhere near the list it belongs to (PLAN.md decision 11).
import { make } from './dom';

export interface PointRow {
  /** 'u:<i>' library point, 'l:<i>' not-yet-uploaded old point, 'b:<i>' built-in. */
  ref: string;
  name: string;
  /** Yours — can be deleted. */
  mine: boolean;
}

export interface PointListHandlers {
  onPick(ref: string): void;
  onDelete(ref: string): void;
}

function group(root: HTMLElement, label: string): void {
  root.appendChild(make('p', 'point-group', label));
}

export function renderPointList(
  root: HTMLElement,
  rows: PointRow[],
  current: string,
  handlers: PointListHandlers,
): void {
  root.replaceChildren();
  const mine = rows.filter((r) => r.mine);
  const builtin = rows.filter((r) => !r.mine);

  group(root, 'My points');
  if (mine.length === 0) {
    root.appendChild(make('p', 'point-empty', 'Nothing saved yet — 💾 Save keeps the point you are hearing.'));
  }
  for (const row of mine) root.appendChild(pointRow(row, current, handlers));

  group(root, 'Built-in');
  for (const row of builtin) root.appendChild(pointRow(row, current, handlers));
}

function pointRow(row: PointRow, current: string, handlers: PointListHandlers): HTMLElement {
  const wrap = make('div', 'point-row');
  const pick = make('button', 'point-pick', row.mine ? `💾 ${row.name}` : row.name);
  pick.type = 'button';
  pick.dataset.point = row.ref;
  if (row.ref === current) {
    pick.classList.add('current');
    pick.setAttribute('aria-current', 'true');
  }
  pick.addEventListener('click', () => handlers.onPick(row.ref));
  wrap.appendChild(pick);
  if (row.mine) {
    const del = make('button', 'point-del', '🗑');
    del.type = 'button';
    del.dataset.del = row.ref;
    del.title = `Delete “${row.name}”`;
    del.setAttribute('aria-label', `Delete ${row.name}`);
    del.addEventListener('click', () => handlers.onDelete(row.ref));
    wrap.appendChild(del);
  }
  return wrap;
}
