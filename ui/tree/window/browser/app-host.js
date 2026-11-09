// Runs a Silk UI app in the page: a wasm32 build of a program whose `main` calls ui-tree-window's
// `host.runWindow` (directly, or through ui-app-window). The window host's own loop runs inside
// the module as it does natively; the page calls `main` through JSPI, so a wait for input
// (`nextEvent`) or for a WebGPU promise suspends the module and gives the page its turn.
//
//   import { runApp } from '/ui/tree/window/browser/app-host.js';
//   const status = await runApp({ wasm: '/app.wasm', container: document.body });
//
// native/platform/window's WindowHost owns the canvas and its input, native/gpu/webgpu's
// WebGPUHost maps WebGPU onto navigator.gpu, and this file adds the `silk_browser` imports of
// ui-tree-window (console output, the clock, giving the page a turn, the check flag, text kept in
// localStorage) and the C math functions wasm32 has no libm for.
//
// Needs WebGPU and JSPI (WebAssembly.Suspending): Chrome and Edge 137 or later.
import { WindowHost } from '/native/platform/window/browser/window-host.js';
import { WebGPUHost } from '/native/gpu/webgpu/browser/host.ts';

const decoder = new TextDecoder();
const encoder = new TextEncoder();

/** The page's localStorage, or null where it is blocked (some private windows, sandboxed frames). */
function pageStorage() {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

/** Why this browser cannot run the app, or undefined when it can. */
export function unsupported() {
  if (!globalThis.navigator?.gpu) return 'This browser has no WebGPU.';
  if (typeof WebAssembly.Suspending !== 'function' || typeof WebAssembly.promising !== 'function')
    return 'This browser has no WebAssembly JSPI (WebAssembly.Suspending).';
  return undefined;
}

/**
 * Starts the app and resolves with `main`'s exit status when it returns (the window closed, or
 * the check finished). Rejects on a trap or a WebGPU error, with the module's report.
 *
 * - `wasm`: the module's URL, bytes or a compiled WebAssembly.Module.
 * - `container`: where the window's canvas goes (it fills the container).
 * - `check`: run the app's rendering check instead of taking input.
 * - `log(text)`: each line the app prints (default console.log).
 * - `storage`: where the app's `ui_tree_window.browser.store` keeps text: the page's
 *   localStorage, except in check mode, which starts from nothing. Pass null to keep nothing.
 * - `storagePrefix`: put before each key, so apps on one origin can keep apart.
 */
export async function runApp({
  wasm, container = document.body, check = false, log = console.log,
  storage = check ? null : pageStorage(), storagePrefix = 'silk-app:',
}) {
  const problem = unsupported();
  if (problem) throw new Error(problem);
  const text = (pointer, length) => decoder.decode(new Uint8Array(memory.buffer, pointer, length));
  const storedItem = key => {
    try {
      return storage?.getItem(storagePrefix + key) ?? null;
    } catch {
      return null;
    }
  };
  const canvas = document.createElement('canvas');
  canvas.tabIndex = 0;
  Object.assign(canvas.style, { width: '100%', height: '100%', display: 'block', outline: 'none' });
  container.appendChild(canvas);
  const windowHost = new WindowHost({ container });
  windowHost.addCanvas(canvas);
  const gpuHost = new WebGPUHost();
  let memory;
  let line = '';
  const print = text => {
    line += text;
    let end;
    while ((end = line.indexOf('\n')) >= 0) { log(line.slice(0, end)); line = line.slice(end + 1); }
  };
  const imports = {
    window: windowHost.suspendingImports,
    webgpu: gpuHost.imports,
    math: { sin: Math.sin, cos: Math.cos, tan: Math.tan, hypot: Math.hypot, fmod: (x, y) => x % y },
    silk_browser: {
      write: (pointer, length) => print(decoder.decode(new Uint8Array(memory.buffer, pointer, length))),
      now: () => performance.now(),
      check: () => (check ? 1 : 0),
      // A turn of the page's event loop, so pending WebGPU promises settle.
      yield: new WebAssembly.Suspending(() => new Promise(resolve => setTimeout(resolve, 0))),
      // localStorage, as UTF-8: stored_length answers -1 when nothing is kept under the key.
      stored_length: (key, keyLength) => {
        const value = storedItem(text(key, keyLength));
        return value === null ? -1 : encoder.encode(value).length;
      },
      stored_read: (key, keyLength, into, length) => {
        const value = storedItem(text(key, keyLength));
        if (value === null) return -1;
        const bytes = encoder.encode(value);
        if (bytes.length !== length) return -1;
        new Uint8Array(memory.buffer, into, length).set(bytes);
        return length;
      },
      store: (key, keyLength, value, valueLength) => {
        try {
          storage?.setItem(storagePrefix + text(key, keyLength), text(value, valueLength));
          return storage ? 1 : 0;
        } catch {
          return 0;
        }
      },
    },
  };
  const module = wasm instanceof WebAssembly.Module ? wasm
    : ArrayBuffer.isView(wasm) || wasm instanceof ArrayBuffer ? await WebAssembly.compile(wasm)
    : await WebAssembly.compileStreaming(fetch(wasm));
  const instance = await WebAssembly.instantiate(module, imports);
  memory = instance.exports.memory;
  windowHost.attach(instance);
  gpuHost.attach(instance);
  canvas.focus();
  const report = () => {
    const length = instance.exports.silk_report_length?.() ?? 0;
    if (!length) return '';
    return decoder.decode(new Uint8Array(memory.buffer, instance.exports.silk_report(), length).slice());
  };
  let status;
  try {
    status = await WebAssembly.promising(instance.exports.main)();
  } catch (error) {
    const text = report();
    throw new Error(text ? `${text}\n${error?.message ?? error}` : String(error?.message ?? error), { cause: error });
  } finally {
    if (line) log(line);
  }
  if (gpuHost.failures.length) throw new Error(gpuHost.failures.join('\n'));
  if (status !== 0) {
    const text = report();
    if (text) log(text);
  }
  return status;
}
