// In-app replacements for window.prompt / window.confirm.
//
// Mobile browsers are allowed to suppress native dialogs: after a few of
// them Chrome for Android offers "prevent this page from creating more
// dialogs", and from then on prompt() returns null with nothing shown. The
// app then looked broken — Save did nothing, silently. These dialogs are
// ours, so they always appear, and they fit a phone screen.
import { make } from './dom';

interface AskOptions {
  title: string;
  detail?: string;
  ok?: string;
  /** Pre-filled text; its presence turns the dialog into a prompt. */
  value?: string;
}

/** Resolves with the text (trimmed by the caller) or null if cancelled. */
export function askText(opts: AskOptions & { value: string }): Promise<string | null> {
  return open(opts, opts.value);
}

/** Resolves true if confirmed. */
export async function askConfirm(opts: AskOptions): Promise<boolean> {
  return (await open(opts, null)) !== null;
}

function open(opts: AskOptions, value: string | null): Promise<string | null> {
  return new Promise((resolve) => {
    const overlay = make('div', 'ask-overlay');
    overlay.id = 'askDialog';
    const box = make('div', 'ask-box');
    const closeX = make('button', 'panel-close', '✕');
    closeX.type = 'button';
    closeX.title = 'Close (Esc)';
    closeX.setAttribute('aria-label', 'Close');
    box.append(closeX, make('h2', 'ask-title', opts.title));
    if (opts.detail) box.append(make('p', 'ask-detail', opts.detail));

    let input: HTMLInputElement | null = null;
    if (value !== null) {
      input = make('input', 'ask-input');
      input.id = 'askInput';
      input.type = 'text';
      input.value = value;
      box.append(input);
    }

    const row = make('div', 'ask-row');
    const cancel = make('button', 'tb-btn', 'Cancel');
    cancel.id = 'askCancel';
    cancel.type = 'button';
    const okBtn = make('button', 'tb-btn primary', opts.ok ?? 'OK');
    okBtn.id = 'askOk';
    okBtn.type = 'button';
    row.append(cancel, okBtn);
    box.append(row);
    overlay.append(box);

    const previous = document.activeElement;
    let done = false;
    const finish = (result: string | null): void => {
      if (done) return;
      done = true;
      document.removeEventListener('keydown', onKey, true);
      overlay.remove();
      if (previous instanceof HTMLElement) previous.focus();
      resolve(result);
    };
    function onKey(e: KeyboardEvent): void {
      if (e.key === 'Escape') { e.stopPropagation(); finish(null); }
      else if (e.key === 'Enter') { e.stopPropagation(); finish(input ? input.value : ''); }
    }
    // Capture, so the app's own Esc / arrow-key shortcuts stay quiet while
    // a dialog is up.
    document.addEventListener('keydown', onKey, true);
    okBtn.addEventListener('click', () => finish(input ? input.value : ''));
    cancel.addEventListener('click', () => finish(null));
    closeX.addEventListener('click', () => finish(null));
    overlay.addEventListener('pointerdown', (e) => {
      if (e.target === overlay) finish(null);
    });

    document.body.append(overlay);
    if (input) {
      input.focus();
      input.select();
    } else {
      okBtn.focus();
    }
  });
}
