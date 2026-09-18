import { applyGate, gateIsSilent, FADE_STEP } from '../src/dsp/gate';

describe('generator gate', () => {
  it('fade=0 and disabled → silent without computing', () => {
    expect(gateIsSilent(0, false)).toBe(true);
    expect(gateIsSilent(0.5, false)).toBe(false);
    expect(gateIsSilent(0, true)).toBe(false);
    expect(gateIsSilent(1, true)).toBe(false);
  });

  it('fade at target → buffer untouched', () => {
    const buf = new Float32Array([1, 1, 1]);
    expect(applyGate(buf, 1, true)).toBe(1);
    expect(Array.from(buf)).toEqual([1, 1, 1]);
    expect(applyGate(buf, 0, false)).toBe(0);
    expect(Array.from(buf)).toEqual([1, 1, 1]);
  });

  it('disabling: monotonic fade to zero within 5 blocks of 128', () => {
    let fade = 1;
    for (let b = 0; b < 5; b++) {
      const buf = new Float32Array(128).fill(1);
      fade = applyGate(buf, fade, false);
      for (let i = 1; i < buf.length; i++) expect(buf[i]).toBeLessThanOrEqual(buf[i - 1]);
    }
    expect(fade).toBe(0);
  });

  it('enabling: fade rises to one', () => {
    let fade = 0;
    for (let b = 0; b < 5; b++) {
      const buf = new Float32Array(128).fill(1);
      fade = applyGate(buf, fade, true);
    }
    expect(fade).toBe(1);
  });

  it('first sample after enabling is near zero (no click)', () => {
    const buf = new Float32Array(128).fill(1);
    applyGate(buf, 0, true);
    expect(buf[0]).toBeCloseTo(FADE_STEP, 6);
  });
});
