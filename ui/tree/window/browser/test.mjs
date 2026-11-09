#!/usr/bin/env node
// A Silk app page in the installed Chromium (WebGPU through navigator.gpu, SwiftShader in CI):
//
// 1. `/?check`: the app runs its rendering check (the scripted click and Tab, then the canvas
//    read back and compared with the CPU reference of the same frame); `main` must return 0.
// 2. `/`: the app runs with real input for a while: pointer moves, a click at `--click X,Y`
//    (CSS pixels), typing and a wheel turn, with no page, console or WebGPU errors.
// 3. With `--stored KEY`: the app kept text under KEY in localStorage (holding the typed text,
//    when there is some), and a reload starts from it with no errors.
//
//   node ui/tree/window/browser/test.mjs --wasm APP.wasm [--click X,Y] [--type TEXT]
//        [--size WIDTH,HEIGHT] [--scale N] [--screenshot FILE] [--stored KEY]
//
// Never downloads a browser.
import { createRequire } from 'node:module';
import { serve } from './serve.mjs';

const option = (name, fallback) => {
  const index = process.argv.indexOf(name);
  return index < 0 ? fallback : process.argv[index + 1];
};
const wasm = option('--wasm');
if (!wasm) throw new Error('Usage: node ui/tree/window/browser/test.mjs --wasm APP.wasm');
const [width, height] = option('--size', '800,600').split(',').map(Number);
const scale = Number(option('--scale', '1'));
const click = option('--click')?.split(',').map(Number);
const typed = option('--type');
const screenshot = option('--screenshot');
const storedKey = option('--stored');
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright')); }
catch (error) { throw new Error('An existing Playwright installation is required (set PLAYWRIGHT_MODULE to its installed absolute module path); do not run playwright install', { cause: error }); }

const server = await serve(wasm);
const origin = `http://127.0.0.1:${server.address().port}`;
let browser;
let failed = false;
try {
  browser = await chromium.launch({ headless: process.platform !== 'linux',
    executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined, args: [
      '--enable-unsafe-webgpu', '--use-angle=swiftshader', '--enable-features=Vulkan',
      '--disable-vulkan-surface', '--enable-unsafe-swiftshader',
      ...(process.platform === 'linux' ? ['--use-vulkan=swiftshader'] : []),
    ] });
  console.log(`Chromium ${browser.version()} (${process.platform}): ${wasm}`);
  const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: scale });

  const watch = page => {
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => {
      if (message.type() === 'error') errors.push(message.text());
      else console.log(`  [page] ${message.text()}`);
    });
    return errors;
  };

  // 1. The check.
  const checkPage = await context.newPage();
  const checkErrors = watch(checkPage);
  await checkPage.goto(`${origin}/?check`);
  await checkPage.waitForFunction(() => window.appResult !== undefined, null, { timeout: 300000 });
  const result = await checkPage.evaluate(() => window.appResult);
  const passed = result.status === 0 && !checkErrors.length;
  console.log(`${passed ? 'PASS' : 'FAIL'} check: ${result.error ?? `main returned ${result.status}`}`);
  if (!passed) { failed = true; if (checkErrors.length) console.log(checkErrors.join('\n')); }
  await checkPage.close();

  // 2. Real input.
  const page = await context.newPage();
  const errors = watch(page);
  await page.goto(`${origin}/`);
  await page.waitForFunction(() => document.querySelector('canvas')?.width > 0 || window.appResult, null, { timeout: 120000 });
  await page.waitForTimeout(1500);
  for (const [x, y] of [[width * 0.3, height * 0.3], [width * 0.6, height * 0.5], [width * 0.5, height * 0.7]]) {
    await page.mouse.move(x, y, { steps: 4 });
    await page.waitForTimeout(80);
  }
  if (click) {
    await page.mouse.click(click[0], click[1]);
    await page.waitForTimeout(300);
  }
  if (typed) {
    await page.keyboard.type(typed, { delay: 30 });
    await page.waitForTimeout(300);
  }
  await page.mouse.move(width * 0.5, height * 0.5);
  await page.mouse.wheel(0, 400);
  await page.waitForTimeout(800);
  const state = await page.evaluate(() => window.appResult);
  if (state?.error) errors.push(state.error);
  console.log(`${errors.length ? 'FAIL' : 'PASS'} input: pointer, click, keys and wheel with no errors`);
  if (errors.length) { console.log(errors.join('\n')); failed = true; }
  if (screenshot) await page.screenshot({ path: screenshot });

  // 3. What the app kept, and a reload that reads it.
  if (storedKey) {
    const key = `silk-app:${storedKey}`;
    const kept = await page.waitForFunction(([key, typed]) => {
      const value = localStorage.getItem(key);
      return value && (!typed || value.includes(typed)) ? value.length : 0;
    }, [key, typed], { timeout: 10000 }).then(handle => handle.jsonValue(), () => 0);
    console.log(`${kept ? 'PASS' : 'FAIL'} stored: ${kept ? `${kept} characters under ${key}` : `nothing${typed ? ` holding "${typed}"` : ''} under ${key}`}`);
    if (!kept) failed = true;
    errors.length = 0;
    await page.reload();
    await page.waitForFunction(() => document.querySelector('canvas')?.width > 0 || window.appResult, null, { timeout: 120000 });
    await page.waitForTimeout(1500);
    const reloaded = await page.evaluate(() => window.appResult);
    if (reloaded?.error) errors.push(reloaded.error);
    console.log(`${errors.length ? 'FAIL' : 'PASS'} reload: the app started from what it kept`);
    if (errors.length) { console.log(errors.join('\n')); failed = true; }
  }
} finally {
  await browser?.close();
  const closed = Promise.withResolvers();
  server.close(closed.resolve);
  await closed.promise;
}
if (failed) process.exit(1);
