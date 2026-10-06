import { CoreFrames } from '../src/audio/coreFrames';
import { FRAME, FRAME_LEN } from '../src/core/protocol';

function frame(time: number, hits: number, loudness = 0.5): Float64Array {
  const f = new Float64Array(FRAME_LEN);
  f[FRAME.time] = time;
  f[FRAME.hits] = hits;
  f[FRAME.loudness] = loudness;
  return f;
}

describe('CoreFrames', () => {
  it('gives the frame heard at a time, not the newest rendered', () => {
    const c = new CoreFrames();
    for (let i = 1; i <= 10; i++) c.push(frame(i * 0.02, 0, i / 10));
    expect(c.at(0.105)?.[FRAME.time]).toBeCloseTo(0.1);
    expect(c.features(0.105)?.loudness).toBeCloseTo(0.5);
    expect(c.at(0.001)?.[FRAME.time]).toBeCloseTo(0.02); // before any: the oldest
    expect(new CoreFrames().features(1)).toBeNull();
  });

  it('reports each new hit once, when it is heard', () => {
    const c = new CoreFrames();
    c.push(frame(0.02, 3));
    expect(c.hitHeard(0.02)).toBe(false); // what came before we listened
    c.push(frame(0.04, 3));
    c.push(frame(0.06, 5));
    expect(c.hitHeard(0.05)).toBe(false); // rendered, not heard yet
    expect(c.hitHeard(0.06)).toBe(true);
    expect(c.hitHeard(0.07)).toBe(false);
  });

  it('keeps a bounded ring', () => {
    const c = new CoreFrames();
    for (let i = 0; i < 1000; i++) c.push(frame(i, 0));
    expect(c.at(0)?.[FRAME.time]).toBe(936);
  });
});
