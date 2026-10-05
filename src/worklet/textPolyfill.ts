// The wasm-bindgen glue creates a TextDecoder and a TextEncoder when it is
// evaluated (the session's exports take strings), and an AudioWorklet's
// scope has neither in Chromium (probed, PLAN-CORE.md phase 0). The audio
// side's exports take and return numbers and byte arrays only, so these are
// reached only by a panic message or a string export; minimal UTF-8 ones
// keep the glue loadable. Without them the module throws as it loads and
// the processor is never registered. Import this BEFORE the glue: imports
// are evaluated in order.

/** UTF-8 → string; invalid sequences become U+FFFD. */
export function decodeUtf8(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length;) {
    const b = bytes[i];
    const n = b < 0x80 ? 0 : b >= 0xf0 ? 3 : b >= 0xe0 ? 2 : b >= 0xc0 ? 1 : -1;
    if (n < 0 || i + n >= bytes.length) {
      s += '�';
      i++;
      continue;
    }
    let cp = n === 0 ? b : b & (0x3f >> n);
    for (let k = 1; k <= n; k++) cp = (cp << 6) | (bytes[i + k] & 0x3f);
    s += String.fromCodePoint(cp);
    i += n + 1;
  }
  return s;
}

class MinimalTextDecoder {
  decode(input?: BufferSource): string {
    if (input === undefined) return '';
    const bytes = input instanceof Uint8Array ? input
      : ArrayBuffer.isView(input) ? new Uint8Array(input.buffer, input.byteOffset, input.byteLength)
        : new Uint8Array(input);
    return decodeUtf8(bytes);
  }
}

/** string → UTF-8. A lone surrogate becomes U+FFFD, as TextEncoder does. */
export function encodeUtf8(s: string): Uint8Array {
  const out: number[] = [];
  for (const ch of s) {
    let cp = ch.codePointAt(0) ?? 0xfffd;
    if (cp >= 0xd800 && cp <= 0xdfff) cp = 0xfffd;
    if (cp < 0x80) out.push(cp);
    else if (cp < 0x800) out.push(0xc0 | (cp >> 6), 0x80 | (cp & 0x3f));
    else if (cp < 0x10000) out.push(0xe0 | (cp >> 12), 0x80 | ((cp >> 6) & 0x3f), 0x80 | (cp & 0x3f));
    else out.push(0xf0 | (cp >> 18), 0x80 | ((cp >> 12) & 0x3f), 0x80 | ((cp >> 6) & 0x3f), 0x80 | (cp & 0x3f));
  }
  return Uint8Array.from(out);
}

class MinimalTextEncoder {
  readonly encoding = 'utf-8';
  encode(input = ''): Uint8Array {
    return encodeUtf8(input);
  }
}

if (typeof globalThis.TextEncoder === 'undefined') {
  Object.defineProperty(globalThis, 'TextEncoder', { value: MinimalTextEncoder, configurable: true, writable: true });
}

if (typeof globalThis.TextDecoder === 'undefined') {
  Object.defineProperty(globalThis, 'TextDecoder', { value: MinimalTextDecoder, configurable: true, writable: true });
}
