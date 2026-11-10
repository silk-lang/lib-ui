// Provision from the manifest-pinned native tooling, never a sibling checkout.
// lib-native's provisioning is a Silk task. A task is compiled code, so this script first
// selects a working LLVM 22 and, on macOS, the SDK; the task then provisions the rest.
import { createHash } from 'node:crypto';
import { appendFileSync, createReadStream, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { delimiter, dirname, resolve } from 'node:path';
import { root, silk, run } from './internal.mjs';
import { repositoryRoot } from './dependency-root.mjs';

const options = process.argv.slice(2);
for (const option of options) if (!['--browser', '--linux-gpu'].includes(option)) throw new Error(`Unknown option: ${option}`);
const lock = JSON.parse(readFileSync(resolve(root, 'toolchains.lock.json'), 'utf8'));
const arch = { arm64: 'aarch64', x64: 'x86_64' }[process.arch];
const system = { darwin: 'apple-darwin', linux: 'unknown-linux-gnu', win32: 'pc-windows-msvc' }[process.platform];
const target = `${arch}-${system}`;
const suffix = process.platform === 'win32' ? '.exe' : '';

function exportEnv(name, value) {
  console.log(`${name}=${value}`);
  process.env[name] = value;
  if (process.env.GITHUB_ENV) appendFileSync(process.env.GITHUB_ENV, `${name}=${value}\n`);
}
function exportPath(directory) {
  console.log(`PATH: ${directory}`);
  process.env.PATH = [directory, process.env.PATH].join(delimiter);
  if (process.env.GITHUB_PATH) appendFileSync(process.env.GITHUB_PATH, directory + '\n');
}
function which(name) {
  for (const directory of (process.env.PATH ?? '').split(delimiter)) {
    const path = resolve(directory, name + suffix);
    if (directory && existsSync(path)) return path;
  }
}
function clang22(path) {
  if (!path || !existsSync(path)) return false;
  const result = spawnSync(path, ['--version'], { encoding: 'utf8' });
  return result.status === 0 && /clang version 22\./.test(result.stdout);
}
async function download(asset) {
  if (!asset) throw new Error(`No pinned asset for ${target}`);
  const directory = resolve(root, '.cache/downloads');
  mkdirSync(directory, { recursive: true });
  const path = resolve(directory, `${asset.sha256}-${decodeURIComponent(new URL(asset.url).pathname.split('/').pop())}`);
  if (!existsSync(path)) {
    run('curl', ['--fail', '--location', '--silent', '--show-error', '--output', path + '.part', asset.url]);
    renameSync(path + '.part', path);
  }
  const hash = createHash('sha256');
  let bytes = 0;
  for await (const chunk of createReadStream(path)) { hash.update(chunk); bytes += chunk.length; }
  if (bytes !== asset.bytes || hash.digest('hex') !== asset.sha256) throw new Error(`Checksum/size mismatch: ${path}`);
  return path;
}
// Every pinned archive has one root directory, which becomes the destination.
async function install(asset, destination) {
  const marker = resolve(destination, '.archive-sha256');
  if (existsSync(destination)) {
    if (!existsSync(marker) || readFileSync(marker, 'utf8').trim() !== asset?.sha256) throw new Error(`Unverified installation: ${destination}; remove it before reinstalling`);
    return destination;
  }
  const archive = await download(asset);
  mkdirSync(dirname(destination), { recursive: true });
  const temporary = mkdtempSync(resolve(dirname(destination), '.extract-'));
  try {
    run('tar', ['-xf', archive, '-C', temporary]);
    const entries = readdirSync(temporary, { withFileTypes: true });
    if (entries.length !== 1 || !entries[0].isDirectory()) throw new Error(`Expected one archive root: ${archive}`);
    writeFileSync(resolve(temporary, entries[0].name, '.archive-sha256'), asset.sha256 + '\n');
    renameSync(resolve(temporary, entries[0].name), destination);
  } finally { rmSync(temporary, { recursive: true, force: true }); }
  return destination;
}

let clang = process.env.SILK_CLANG;
if (clang && !clang22(clang)) throw new Error('SILK_CLANG must name a working LLVM 22 clang');
if (!clang && process.platform === 'darwin' && process.env.CI) {
  const brew = which('brew');
  if (brew && !existsSync('/opt/homebrew/opt/llvm@22/bin/clang') && !existsSync('/usr/local/opt/llvm@22/bin/clang')) run(brew, ['install', 'llvm@22']);
  if (brew && !existsSync('/opt/homebrew/opt/lld@22/bin/ld64.lld') && !existsSync('/usr/local/opt/lld@22/bin/ld64.lld')) run(brew, ['install', 'lld@22']);
}
clang ??= ['/opt/homebrew/opt/llvm@22/bin/clang', '/usr/local/opt/llvm@22/bin/clang', '/opt/homebrew/opt/llvm/bin/clang', '/usr/local/opt/llvm/bin/clang',
  '/usr/bin/clang-22', which('clang-22'), which('clang')].find(clang22);
if (!clang) clang = resolve(await install(lock.llvm.platforms[target], resolve(root, '.cache/llvm', lock.llvm.version, target)), 'bin', `clang${suffix}`);
if (!clang22(clang)) throw new Error(`LLVM cannot run: ${clang}`);
exportEnv('SILK_CLANG', clang);
for (const linker of ['/opt/homebrew/opt/lld@22/bin', '/usr/local/opt/lld@22/bin', '/usr/lib/llvm-22/bin']) {
  if (existsSync(linker) && !(process.env.PATH ?? '').split(delimiter).includes(linker)) exportPath(linker);
}
if (process.platform === 'darwin' && !process.env.SDKROOT) {
  exportEnv('SDKROOT', run('xcrun', ['--sdk', 'macosx', '--show-sdk-path'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] }).stdout.trim());
}

run(silk, ['check', '--manifest-path', resolve(root, 'modules/tree/window/silk.toml')]);
run(silk, ['task', '--manifest-path', resolve(repositoryRoot('lib-native'), 'silk.toml'), 'setup-ci', ...options]);

// The browser suites drive the selected Chromium through Playwright, pinned here.
if (options.includes('--browser')) {
  const chromium = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || process.env.CHROMIUM_EXECUTABLE || which('chromium') || which('chromium-browser') || which('google-chrome');
  if (!chromium || !existsSync(chromium)) throw new Error('Existing Chromium required; CI never downloads a browser');
  const modules = resolve(root, '.cache/playwright', lock.playwright.version, 'node_modules');
  for (const [name, asset] of Object.entries(lock.playwright.packages)) await install(asset, resolve(modules, name));
  exportEnv('PLAYWRIGHT_MODULE', resolve(modules, 'playwright'));
  exportEnv('PLAYWRIGHT_CHROMIUM_EXECUTABLE', chromium);
}
