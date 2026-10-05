// The wasm-bindgen glue creates a TextDecoder when it is evaluated, and an
// AudioWorklet's scope has none in some browsers (PLAN-CORE.md phase 0).
// The audio side's exports take and return numbers and byte arrays only, so
// the decoder is reached only by a panic message or a string export; this
// minimal UTF-8 one keeps the glue loadable and those readable. Import it
// BEFORE the glue: imports are evaluated in order.

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

if (typeof globalThis.TextDecoder === 'undefined') {
  Object.defineProperty(globalThis, 'TextDecoder', { value: MinimalTextDecoder, configurable: true, writable: true });
}
