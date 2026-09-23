import { silentWavDataUri } from '../src/audio/iosUnlock';

const decode = (uri: string): Uint8Array => {
  const bin = atob(uri.slice('data:audio/wav;base64,'.length));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
};

describe('silentWavDataUri', () => {
  it('is a base64 audio/wav data URI (no binary asset to ship)', () => {
    expect(silentWavDataUri().startsWith('data:audio/wav;base64,')).toBe(true);
  });

  it('decodes to a valid RIFF/WAVE file of the requested length', () => {
    const bytes = decode(silentWavDataUri(0.1, 8000));
    const tag = (o: number) => String.fromCharCode(bytes[o], bytes[o + 1], bytes[o + 2], bytes[o + 3]);
    expect(tag(0)).toBe('RIFF');
    expect(tag(8)).toBe('WAVE');
    expect(tag(12)).toBe('fmt ');
    expect(tag(36)).toBe('data');
    expect(bytes.length).toBe(44 + 800 * 2); // 0.1 s × 8000 Hz, 16-bit mono
  });

  it('is actually silent — it must be inaudible, only the audio session matters', () => {
    expect(decode(silentWavDataUri(0.1, 8000)).slice(44).every((v) => v === 0)).toBe(true);
  });

  it('never produces an empty buffer, however short the request', () => {
    expect(decode(silentWavDataUri(0, 8000)).length).toBe(44 + 2);
  });

  it('is long enough by default for iOS to switch the session category', () => {
    const bytes = decode(silentWavDataUri());
    expect(bytes.length).toBeGreaterThan(44 + 1000);
  });
});
