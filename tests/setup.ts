// The core's wasm, instantiated once for the unit tests: src/core/* (points,
// presets, settings, session) call into it, as the page does after boot().
import { readFileSync } from 'node:fs';
import { initSync } from '../src/core/pkg/syn_wasm.js';

initSync({ module: new WebAssembly.Module(readFileSync(new URL('../src/core/pkg/syn_wasm_bg.wasm', import.meta.url))) });
