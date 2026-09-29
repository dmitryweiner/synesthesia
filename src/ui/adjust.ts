// Fine-tuning −/+ buttons next to the sliders, auto-repeating while held
// (ported from ../formula-synth). One delegated listener per container: a
// button names its slider in data-slider and its direction in data-dir, and
// a press moves the slider one step and fires `input`, exactly as a drag does.
export function setupAdjustmentButtons(container: HTMLElement, repeatDelay = 150): void {
  let interval: ReturnType<typeof setInterval> | null = null;

  function adjust(btn: HTMLElement): void {
    const sliderId = btn.dataset.slider;
    const dir = Number(btn.dataset.dir);
    if (!sliderId) return;
    const slider = document.getElementById(sliderId);
    if (!(slider instanceof HTMLInputElement)) return;
    const step = Number(slider.step) || 1;
    const val = Math.max(Number(slider.min), Math.min(Number(slider.max), Number(slider.value) + dir * step));
    slider.value = String(val);
    slider.dispatchEvent(new Event('input', { bubbles: true }));
  }

  function stop(): void {
    if (interval) {
      clearInterval(interval);
      interval = null;
    }
  }

  container.addEventListener('pointerdown', (e) => {
    if (!(e.target instanceof Element)) return;
    const btn = e.target.closest('.adj-btn');
    if (!(btn instanceof HTMLElement)) return;
    e.preventDefault();
    stop();
    adjust(btn);
    interval = setInterval(() => adjust(btn), repeatDelay);
  });

  // A keyboard press (Enter/Space on a focused button) arrives as a click
  // with no pointer behind it.
  container.addEventListener('click', (e) => {
    if (e.detail !== 0 || !(e.target instanceof Element)) return;
    const btn = e.target.closest('.adj-btn');
    if (btn instanceof HTMLElement) adjust(btn);
  });

  container.addEventListener('pointerup', stop);
  container.addEventListener('pointerleave', stop);
  container.addEventListener('pointercancel', stop);
  document.addEventListener('pointerup', stop);
}
