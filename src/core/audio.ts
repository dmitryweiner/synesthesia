// The main thread's half of the core's sound: compile the wasm module once
// and start the AudioWorklet that hosts it (src/worklet/core.ts).
import workletUrl from '../worklet/core.ts?worker&url';
import wasmUrl from './pkg/syn_wasm_bg.wasm?url';
import { CORE_PROCESSOR, type CoreProcessorOptions } from './protocol';

export interface CoreWasm {
  module: WebAssembly.Module;
  bytes: ArrayBuffer;
}

let compiled: Promise<CoreWasm> | null = null;

/** The core's module, fetched and compiled once per page. */
export function compileCore(): Promise<CoreWasm> {
  compiled ??= (async () => {
    const bytes = await (await fetch(wasmUrl)).arrayBuffer();
    return { module: await WebAssembly.compile(bytes), bytes };
  })();
  return compiled;
}

/** How the module reached the worklet: as a compiled Module, or as bytes
 *  compiled again inside it (a browser that cannot clone a Module there). */
export type CoreTransport = 'module' | 'bytes';

/** Starts the core's processor on `ctx` playing `point` (silent until a
 *  fadeIn command). */
export async function createCoreNode(
  ctx: BaseAudioContext, point: Uint8Array, prefer: CoreTransport = 'module',
): Promise<{ node: AudioWorkletNode; transport: CoreTransport }> {
  const wasm = await compileCore();
  await ctx.audioWorklet.addModule(workletUrl);
  const make = (transport: CoreTransport): AudioWorkletNode => {
    const processorOptions: CoreProcessorOptions = transport === 'module'
      ? { module: wasm.module, point }
      : { bytes: wasm.bytes.slice(0), point };
    return new AudioWorkletNode(ctx, CORE_PROCESSOR, {
      numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [2], processorOptions,
    });
  };
  if (prefer === 'bytes') return { node: make('bytes'), transport: 'bytes' };
  try {
    return { node: make('module'), transport: 'module' };
  } catch {
    // DataCloneError: this browser cannot hand a Module to the worklet.
    return { node: make('bytes'), transport: 'bytes' };
  }
}
