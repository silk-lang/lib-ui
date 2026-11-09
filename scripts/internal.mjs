// Repository tooling only; public Silk libraries do not import this module.
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { delimiter, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { repositoryRoot } from './dependency-root.mjs';
export const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const silk = process.env.SILK || (process.platform === 'win32' ? 'silkc' : 'silk');
export function run(command, args = [], options = {}) {
  console.error('+', command, ...args);
  const result = spawnSync(command, args, { cwd: root, stdio: 'inherit', timeout: 1200000, ...options });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} failed (${result.signal || result.status})${result.stderr ? `: ${result.stderr}` : ''}`);
  return result;
}
export function manifest(packagePath) {
  return resolve(root, packagePath, packagePath.endsWith('.toml') ? '' : 'silk.toml');
}
export function prepareWindows(runtimeDirectory) {
  const result = run('pwsh', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', resolve(repositoryRoot('lib-native'), 'scripts/prepare-windows.ps1'), '-Json',
    ...(process.env.SILK_CLANG ? ['-Clang', process.env.SILK_CLANG] : []),
    ...(runtimeDirectory ? ['-RuntimeDirectory', runtimeDirectory] : [])], { stdio: ['ignore', 'pipe', 'inherit'], encoding: 'utf8' });
  const prepared = JSON.parse(result.stdout);
  process.env.PATH = [resolve(prepared.dawn, 'bin'), prepared.dxc, resolve(prepared.glfw, 'lib-vc2022'), process.env.PATH].join(delimiter);
}
export function build(packagePath, { release = false, wasm = false, clang } = {}) {
  const path = manifest(packagePath);
  if (process.platform === 'win32' && !wasm) {
    run(silk, ['check', '--manifest-path', path]);
    prepareWindows();
  }
  run(silk, ['build', '--manifest-path', path, ...(release ? ['--release'] : []),
    ...(wasm ? ['--target', 'wasm32-unknown-unknown'] : []), ...(clang ? ['--clang', clang] : [])]);
  const name = readFileSync(path, 'utf8').match(/^name\s*=\s*"([^"]+)"/m)?.[1];
  if (!name) throw new Error(`No package name in ${path}`);
  const filename = name + (!wasm && process.platform === 'win32' ? '.exe' : '');
  let workspace = dirname(path);
  for (let directory = workspace; ; directory = dirname(directory)) {
    const candidate = resolve(directory, 'silk.toml');
    if (existsSync(candidate) && /^\[workspace\]/m.test(readFileSync(candidate, 'utf8'))) {
      workspace = directory;
      break;
    }
    if (directory === dirname(directory)) break;
  }
  const candidates = new Set();
  for (const base of [resolve(workspace, 'build/llvm'), resolve(dirname(path), 'build/llvm')]) {
    if (!existsSync(base)) continue;
    for (const target of readdirSync(base)) {
      if (wasm !== (target === 'wasm32-unknown-unknown')) continue;
      const binary = resolve(base, target, release ? 'release' : 'debug', filename);
      if (existsSync(binary)) candidates.add(binary);
    }
  }
  if (candidates.size !== 1) throw new Error(`Expected one ${filename}, found: ${[...candidates].join(', ')}`);
  const binary = [...candidates][0];
  if (process.platform === 'win32' && !wasm) prepareWindows(dirname(binary));
  return binary;
}
