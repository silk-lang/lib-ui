#!/usr/bin/env node
// Runs the compiled ui_tree browser test in the already installed Chromium (WebGPU through
// navigator.gpu) with modules/gpu/webgpu's host, and compares each fixture tree's GPU pixels with the CPU
// reference rendered by the same wasm module. Never downloads a browser. The runner is
// modules/gpu/webgpu's runSamples plus the `math` imports browser/src/libm.silk forwards to.
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { repositoryRoot } from '../../../scripts/dependency-root.mjs';

const webgpu = resolve(repositoryRoot('lib-native'), 'modules/gpu/webgpu');
const wasmIndex = process.argv.indexOf('--wasm');
if (wasmIndex < 0 || !process.argv[wasmIndex + 1]) throw new Error('Usage: node browser/test.mjs --wasm FILE');
const wasm = await readFile(resolve(process.argv[wasmIndex + 1]));
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright')); }
catch (error) { throw new Error('An existing Playwright installation is required (set PLAYWRIGHT_MODULE to its installed absolute module path); do not run playwright install', { cause: error }); }

// The fixture trees of modules/tree/fixtures, in order. The limits are examples/graphics-demo's: whole UI
// frames with text, icons, an image and a gradient.
const fixtures = [
  { name: 'card-list', max: 96, share: 0.002, mean: 0.25 },
  { name: 'form', max: 96, share: 0.002, mean: 0.25 },
  { name: 'inbox', max: 96, share: 0.002, mean: 0.25 },
  { name: 'editor', max: 96, share: 0.002, mean: 0.25 },
];

const page = `<!doctype html><title>Silk UI tree test</title><script type="module">
import { WebGPUHost } from '/browser/host.ts';
window.runTrees = async (indices, timeout) => {
  const module = await WebAssembly.compileStreaming(fetch('/ui.wasm'));
  const results = [];
  for (const index of indices) {
    const output = new Map();
    const host = new WebGPUHost();
    const imports = {
      webgpu: host.imports,
      host: { sample_output(kind, ptr, length) { output.set(kind, host.bytes(ptr, length).slice()); } },
      math: { sin: Math.sin, cos: Math.cos, tan: Math.tan, hypot: Math.hypot, fmod: (x, y) => x % y },
    };
    const instance = await WebAssembly.instantiate(module, imports);
    host.attach(instance);
    const state = host.call('sample_start', index);
    if (!state) throw new Error('sample_start(' + index + ') failed');
    try {
      await new Promise((resolve, reject) => {
        let stopped = false, frame;
        const deadline = setTimeout(() => finish(new Error('tree ' + index + ' timed out')), timeout);
        const finish = error => {
          if (stopped) return;
          stopped = true; clearTimeout(deadline); cancelAnimationFrame(frame); host.onWake = undefined;
          error ? reject(error) : resolve();
        };
        const poll = () => {
          if (stopped) return;
          try {
            const status = host.call('sample_poll', state);
            if (status === 1) finish();
            else if (status < 0) finish(new Error('tree ' + index + ' failed: ' + new TextDecoder().decode(output.get(3) ?? new Uint8Array())));
          } catch (error) { finish(error); }
        };
        const tick = () => { poll(); if (!stopped) frame = requestAnimationFrame(tick); };
        host.onWake = poll;
        tick();
      });
    } finally { host.call('sample_drop', state); }
    await new Promise(resolve => setTimeout(resolve, 0));
    host.assertClean();
    const size = new DataView(output.get(0).buffer);
    results.push({ index, width: size.getUint32(0, true), height: size.getUint32(4, true),
      gpu: Array.from(output.get(1)), cpu: Array.from(output.get(2)) });
  }
  return results;
};
window.ready = true;
</script>`;

const server = createServer(async (request, response) => {
  try {
    const pathname = new URL(request.url, 'http://127.0.0.1').pathname;
    if (pathname === '/ui.wasm') { response.setHeader('Content-Type', 'application/wasm'); response.end(wasm); return; }
    if (pathname === '/') { response.setHeader('Content-Type', 'text/html'); response.end(page); return; }
    const path = resolve(webgpu, '.' + decodeURIComponent(pathname));
    if (!path.startsWith(webgpu + sep) || !['.ts', '.js'].includes(extname(path))) { response.writeHead(404); response.end(); return; }
    response.setHeader('Content-Type', 'text/javascript');
    response.end(await readFile(path));
  } catch (error) { response.writeHead(500); response.end(String(error)); }
});
const listening = Promise.withResolvers();
server.once('error', listening.reject);
server.listen(0, '127.0.0.1', listening.resolve);
await listening.promise;
let browser;
let failures = 0;
try {
  browser = await chromium.launch({ headless: process.platform !== 'linux',
    executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined, args: [
    '--enable-unsafe-webgpu', '--use-angle=swiftshader', '--enable-features=Vulkan',
    '--disable-vulkan-surface', '--enable-unsafe-swiftshader',
    ...(process.platform === 'linux' ? ['--use-vulkan=swiftshader'] : []),
  ] });
  console.log(`Chromium ${browser.version()} (${process.platform}): ui_tree frames against the CPU reference`);
  const tab = await browser.newPage();
  const errors = [];
  tab.on('pageerror', error => errors.push(error.message));
  tab.on('console', message => {
    if (message.type() === 'error' || message.type() === 'warning') console.error(`[Chromium ${message.type()}] ${message.text()}`);
  });
  await tab.goto(`http://127.0.0.1:${server.address().port}/`);
  await tab.waitForFunction(() => window.ready === true);
  const indices = Array.from({ length: fixtures.length * 2 }, (_, i) => i);
  const results = await tab.evaluate(({ indices }) => window.runTrees(indices, 120000), { indices });
  if (errors.length) throw new Error(errors.join('\n'));
  for (const result of results) {
    const fixture = fixtures[result.index % fixtures.length];
    const target = result.index < fixtures.length ? 'rgba8' : 'bgra8';
    const { cpu, gpu } = result;
    if (cpu.length !== gpu.length || cpu.length !== result.width * result.height * 4) throw new Error(`${fixture.name}: sizes differ`);
    let max = 0, over = 0, sum = 0, worst = 0;
    for (let i = 0; i < cpu.length; i++) {
      const d = Math.abs(cpu[i] - gpu[i]);
      if (d > max) { max = d; worst = i; }
      if (d > 8) over++;
      sum += d;
    }
    const mean = sum / cpu.length;
    const ok = max <= fixture.max && over / cpu.length <= fixture.share && mean <= fixture.mean;
    if (!ok) failures++;
    const pixel = worst >> 2;
    console.log(`${ok ? 'PASS' : 'FAIL'} ${fixture.name} (${target}, ${result.width}x${result.height}): max delta ${max} at ${pixel % result.width},${Math.floor(pixel / result.width)}, ${over} of ${cpu.length} channels over 8, mean ${mean.toFixed(4)}`);
  }
} finally {
  await browser?.close();
  const closed = Promise.withResolvers();
  server.close(closed.resolve);
  await closed.promise;
}
if (failures) process.exit(1);
