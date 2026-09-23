// iOS Safari: the hardware Ring/Silent switch mutes Web Audio, because the
// audio session sits on the "ringer" category by default. Playing a short
// silent <audio> element inside the user gesture moves the session to the
// media category, and Web Audio stops depending on the switch. The trick is
// well known (swevans/unmute, feross/unmute-ios-audio); it is inline here
// because this project takes no runtime dependencies. It is not 100%
// reliable — that is a platform limit — but it covers the common report of
// "I press Sound and nothing happens".
//
// Ported from ../formula-synth/src/audio/iosUnlock.ts, with the WAV bytes
// written here instead of pulling in a whole encoder module.

/**
 * A silent 16-bit mono WAV as a data URI. Half a second, not an instant, so
 * iOS has time to switch the session category.
 */
export function silentWavDataUri(seconds = 0.5, sampleRate = 8000): string {
  const samples = Math.max(1, Math.round(seconds * sampleRate));
  const dataSize = samples * 2;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);
  const tag = (offset: number, text: string): void => {
    for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i));
  };
  tag(0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  tag(8, 'WAVE');
  tag(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); // byte rate
  view.setUint16(32, 2, true); // block align
  view.setUint16(34, 16, true); // bits per sample
  tag(36, 'data');
  view.setUint32(40, dataSize, true);
  // The samples themselves are already zero — that is the whole point.

  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return `data:audio/wav;base64,${btoa(binary)}`;
}

/**
 * Keeps the silent element looping for as long as the engine plays, so iOS
 * does not put the session back on the ringer channel.
 */
export class IosAudioUnlock {
  private el: HTMLAudioElement | null = null;

  /**
   * MUST be called SYNCHRONOUSLY inside the user gesture (the Sound click),
   * before any `await` — otherwise iOS does not count it as an activation
   * and the trick does nothing. The returned promise is only for reporting
   * whether the element started; awaiting it is never required.
   */
  play(): Promise<boolean> {
    if (!this.el) {
      const a = new Audio(silentWavDataUri());
      a.loop = true;
      a.setAttribute('playsinline', '');
      // Deliberately NOT muted: a muted element does not change the session
      // category. The samples are silence, so nothing is audible anyway.
      a.volume = 1;
      this.el = a;
    }
    // Refusal (no gesture, autoplay policy) is survivable: only the Ring/
    // Silent switch case is lost, so it is reported, not thrown.
    return this.el.play().then(() => true, () => false);
  }

  stop(): void {
    if (!this.el) return;
    this.el.pause();
    this.el.currentTime = 0;
  }
}
