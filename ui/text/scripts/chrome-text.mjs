#!/usr/bin/env node
// Lays out each case of tests/chrome/cases.json with ui-text-cli (css-layout + ui-text over real
// fonts) and with Chrome, and compares every text fragment's rectangle.
// Usage (from the repository root):
//   node ui/text/scripts/chrome-text.mjs --cli build/llvm/x86_64-unknown-linux-gnu/debug/ui-text-cli
//        [--chrome PATH] [--tolerance 0.1] [--block-tolerance 0.5] [--only name] [--verbose]
// Exits nonzero when a fragment differs by more than the tolerance in any coordinate.
import { spawn, spawnSync } from 'node:child_process';
import { access, mkdtemp, readFile, rm } from 'node:fs/promises';
import { constants } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repositoryRoot = resolve(packageRoot, '../..');
// Inline positions are compared within 0.1 px: Chrome rounds each text box to 1/64 px
// LayoutUnits, which adds up along a line. Block
// positions are compared within half a pixel: Blink floors the half-leading above the baseline
// to whole pixels, while css-layout keeps the exact half (CSS Inline 3 §5.1).
const options = { cli: process.env.UI_TEXT_CLI, chrome: process.env.CHROME_PATH, tolerance: 0.1, blockTolerance: 0.5, only: null, verbose: false,
  cases: join(packageRoot, 'tests/chrome/cases.json') };
for (let index = 2; index < process.argv.length; index++) {
  const argument = process.argv[index];
  const value = () => process.argv[++index];
  if (argument === '--cli') options.cli = value();
  else if (argument === '--chrome') options.chrome = value();
  else if (argument === '--tolerance') options.tolerance = Number(value());
  else if (argument === '--block-tolerance') options.blockTolerance = Number(value());
  else if (argument === '--only') options.only = value();
  else if (argument === '--cases') options.cases = resolve(value());
  else if (argument === '--verbose') options.verbose = true;
  else throw new Error(`Unknown argument ${argument}`);
}
if (!options.cli) throw new Error('Pass --cli PATH (or UI_TEXT_CLI) to the built ui-text-cli');

const hundredths = value => String(Math.round(value * 100));
const encode = text => Array.from(new TextEncoder().encode(text), byte =>
  (byte > 32 && byte < 127 && byte !== 37) ? String.fromCharCode(byte) : `%${byte.toString(16).padStart(2, '0')}`).join('');

function protocol(test) {
  const lines = [];
  for (const font of test.fonts) lines.push(`font ${font.path}`);
  for (const family of test.fallbacks ?? []) lines.push(`fallback ${family}`);
  for (const style of test.styles) {
    lines.push(`style ${hundredths(style.size)} ${style.weight ?? 400} ${style.style ?? 'normal'} ${style.families.join('|')}`);
  }
  const block = test.block;
  lines.push(`block ${hundredths(block.width)} ${block.direction ?? 'ltr'} ${block.align ?? 'start'} ${block.lineHeight === undefined ? 'normal' : hundredths(block.lineHeight)} ${block.whiteSpace ?? 'collapse'} ${block.style ?? 0}`);
  const walk = content => {
    for (const item of content) {
      if (typeof item === 'string') lines.push(`text ${encode(item)}`);
      else {
        lines.push(`open ${item.style ?? block.style ?? 0}${item.bidi ? ` ${item.bidi} ${item.direction ?? 'ltr'}` : ''}`);
        walk(item.content);
        lines.push('close');
      }
    }
  };
  walk(test.content);
  lines.push('close');
  return `${lines.join('\n')}\n`;
}

function native(test) {
  const result = spawnSync(resolve(options.cli), [], { cwd: repositoryRoot, input: protocol(test), encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`ui-text-cli failed on ${test.name}: ${result.stderr}`);
  return JSON.parse(result.stdout);
}

async function findChrome() {
  if (options.chrome) { await access(options.chrome, constants.X_OK); return resolve(options.chrome); }
  const candidates = process.platform === 'darwin'
    ? ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Chromium.app/Contents/MacOS/Chromium']
    : ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser'];
  for (const path of candidates) {
    try { await access(path, constants.X_OK); return path; } catch { /* next */ }
  }
  throw new Error('Chrome not found; pass --chrome PATH or set CHROME_PATH');
}

// Chrome DevTools Protocol over --remote-debugging-pipe, as css/layout/scripts/chrome-diff.mjs.
class Chrome {
  static async start() {
    const executable = await findChrome();
    const profile = await mkdtemp(join(tmpdir(), 'ui-text-chrome-'));
    const child = spawn(executable, ['--headless=new', '--remote-debugging-pipe', `--user-data-dir=${profile}`,
      '--no-first-run', '--no-default-browser-check', '--disable-background-networking', '--disable-component-update',
      '--disable-extensions', '--force-device-scale-factor=1', '--font-render-hinting=none', 'about:blank'],
    { stdio: ['ignore', 'ignore', 'pipe', 'pipe', 'pipe'] });
    const chrome = new Chrome(child, profile);
    chrome.version = await chrome.send('Browser.getVersion');
    const { targetId } = await chrome.send('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await chrome.send('Target.attachToTarget', { targetId, flatten: true });
    chrome.sessionId = sessionId;
    return chrome;
  }
  constructor(child, profile) {
    this.child = child; this.profile = profile; this.nextId = 0; this.pending = new Map();
    this.buffer = Buffer.alloc(0); this.stderr = '';
    child.stderr.on('data', chunk => { this.stderr = (this.stderr + chunk).slice(-8000); });
    child.stdio[4].on('data', chunk => {
      this.buffer = Buffer.concat([this.buffer, chunk]);
      for (let end; (end = this.buffer.indexOf(0)) !== -1;) {
        const data = this.buffer.subarray(0, end).toString(); this.buffer = this.buffer.subarray(end + 1);
        if (!data) continue;
        const message = JSON.parse(data);
        const pending = this.pending.get(message.id);
        if (!pending) continue;
        this.pending.delete(message.id); clearTimeout(pending.timer);
        if (message.error) pending.reject(new Error(JSON.stringify(message.error)));
        else pending.resolve(message.result);
      }
    });
    child.on('exit', (code, signal) => {
      for (const pending of this.pending.values()) pending.reject(new Error(`Chrome exited ${code ?? signal}: ${this.stderr}`));
    });
  }
  send(method, params = {}, sessionId = this.sessionId) {
    const id = ++this.nextId;
    return new Promise((resolvePromise, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`CDP timeout: ${method}`)); }, 30000);
      this.pending.set(id, { resolve: resolvePromise, reject, timer });
      this.child.stdio[3].write(`${JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) })}\0`);
    });
  }
  async evaluate(source) {
    const result = await this.send('Runtime.evaluate', { expression: source, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
    return result.result.value;
  }
  async close() {
    const exited = new Promise(done => this.child.once('exit', done));
    this.child.kill('SIGTERM');
    await exited;
    // Chrome's helper processes can still be writing to the profile after the browser exits.
    await rm(this.profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  }
}

// Runs in the page: builds the case, then measures the native fragments' ranges.
async function observe(test, fonts, fragments, listRects) {
  document.body.style.cssText = 'margin:0;padding:0;';
  document.body.replaceChildren();
  document.fonts.clear();
  for (const font of fonts) {
    const face = new FontFace(font.family, `url(data:font/ttf;base64,${font.data})`,
      { weight: String(font.weight ?? 400), style: font.style ?? 'normal' });
    document.fonts.add(face);
    await face.load();
  }
  const fallbacks = test.fallbacks ?? [];
  const family = style => [...style.families, ...fallbacks].map(name => `"${name}"`).join(', ');
  const apply = (element, style) => {
    element.style.fontFamily = family(style);
    element.style.fontSize = `${style.size}px`;
    element.style.fontWeight = String(style.weight ?? 400);
    element.style.fontStyle = style.style ?? 'normal';
    element.style.fontSynthesis = 'none';
  };
  const block = test.block;
  const container = document.createElement('div');
  container.style.cssText = 'position:absolute;left:0;top:0;margin:0;padding:0;border:0;';
  container.style.width = `${block.width}px`;
  container.style.direction = block.direction ?? 'ltr';
  container.style.textAlign = block.align ?? 'start';
  container.style.lineHeight = block.lineHeight === undefined ? 'normal' : String(block.lineHeight);
  const space = block.whiteSpace ?? 'collapse';
  container.style.whiteSpace = { collapse: 'normal', preserve: 'pre-wrap', 'pre-line': 'pre-line', 'break-spaces': 'break-spaces', nowrap: 'nowrap' }[space];
  apply(container, test.styles[block.style ?? 0]);
  const texts = [];
  const build = (parent, content) => {
    for (const item of content) {
      if (typeof item === 'string') {
        const node = document.createTextNode(item);
        parent.appendChild(node);
        texts.push(node);
      } else {
        const span = document.createElement('span');
        apply(span, test.styles[item.style ?? 0]);
        if (item.bidi) { span.style.unicodeBidi = item.bidi; span.style.direction = item.direction ?? 'ltr'; }
        parent.appendChild(span);
        build(span, item.content);
      }
    }
  };
  build(container, test.content);
  document.body.appendChild(container);
  await document.fonts.ready;
  const origin = container.getBoundingClientRect();
  const utf16 = (text, byteOffset) => {
    let bytes = 0, index = 0;
    for (const character of text) {
      if (bytes >= byteOffset) break;
      const point = character.codePointAt(0);
      bytes += point < 0x80 ? 1 : point < 0x800 ? 2 : point < 0x10000 ? 3 : 4;
      index += character.length;
    }
    return index;
  };
  return fragments.map(fragment => {
    const node = texts[fragment.node];
    const range = document.createRange();
    range.setStart(node, utf16(node.data, fragment.start));
    range.setEnd(node, utf16(node.data, fragment.end));
    // A range that starts or ends at a line edge also reports an empty box there.
    const rects = [...range.getClientRects()].filter(rect => rect.width > 0);
    const text = node.data.slice(utf16(node.data, fragment.start), utf16(node.data, fragment.end));
    if (!rects.length) return { missing: true, text };
    // A native fragment never crosses lines. A range next to a soft hyphen also reports the
    // generated hyphen at the end of the previous line, so keep the line with the most ink.
    const lines = new Map();
    for (const rect of rects) lines.set(rect.top, [...(lines.get(rect.top) ?? []), rect]);
    const widest = [...lines.values()].sort((a, b) => b.reduce((sum, r) => sum + r.width, 0) - a.reduce((sum, r) => sum + r.width, 0))[0];
    rects.splice(0, rects.length, ...widest);
    const left = Math.min(...rects.map(rect => rect.left)), right = Math.max(...rects.map(rect => rect.right));
    const top = Math.min(...rects.map(rect => rect.top)), bottom = Math.max(...rects.map(rect => rect.bottom));
    return { x: left - origin.left, y: top - origin.top, width: right - left, height: bottom - top, rects: rects.length, text, list: listRects ? rects.map(r => [r.left - origin.left, r.top - origin.top, r.width, r.height]) : undefined };
  });
}

async function main() {
  const cases = JSON.parse(await readFile(options.cases, 'utf8'));
  const chrome = await Chrome.start();
  const summary = { browser: chrome.version.product, tolerance: options.tolerance, blockTolerance: options.blockTolerance,
    cases: 0, fragments: 0, maxInlineDelta: 0, maxBlockDelta: 0, failures: [] };
  try {
    for (const test of cases) {
      if (options.only && test.name !== options.only) continue;
      summary.cases++;
      const result = native(test);
      const fonts = await Promise.all(test.fonts.map(async font => ({ ...font,
        data: (await readFile(join(repositoryRoot, font.path))).toString('base64') })));
      const observed = await chrome.evaluate(`(${observe})(${JSON.stringify(test)}, ${JSON.stringify(fonts)}, ${JSON.stringify(result.texts)}, ${options.verbose})`);
      const failures = [];
      result.texts.forEach((fragment, index) => {
        const browser = observed[index];
        // Spaces are compared through the positions of the words around them: a collapsible
        // space that ends a line has no browser box.
        if (/^\s*$/.test(browser.text)) return;
        if (browser.missing) {
          failures.push({ text: browser.text, native: fragment, chrome: null });
          return;
        }
        summary.fragments++;
        const inline = ['x', 'width'].map(key => Math.abs(fragment[key] - browser[key]));
        const block = ['y', 'height'].map(key => Math.abs(fragment[key] - browser[key]));
        summary.maxInlineDelta = Math.max(summary.maxInlineDelta, ...inline);
        summary.maxBlockDelta = Math.max(summary.maxBlockDelta, ...block);
        if (inline.some(delta => delta > options.tolerance) || block.some(delta => delta > options.blockTolerance)) {
          failures.push({ text: browser.text, native: { x: fragment.x, y: fragment.y, width: fragment.width, height: fragment.height, face: fragment.face, level: fragment.level },
            chrome: { x: browser.x, y: browser.y, width: browser.width, height: browser.height, rects: browser.list ?? browser.rects } });
        }
      });
      if (failures.length) summary.failures.push({ name: test.name, failures });
      const status = failures.length ? `FAIL (${failures.length})` : 'ok';
      process.stderr.write(`${test.name}: ${status}\n`);
      if (options.verbose && failures.length) process.stderr.write(`${JSON.stringify(failures, null, 1)}\n`);
    }
  } finally {
    await chrome.close();
  }
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
  process.exitCode = summary.failures.length ? 1 : 0;
}

await main();
