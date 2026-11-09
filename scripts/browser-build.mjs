import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { delimiter, dirname, resolve } from 'node:path';
import { build, root } from './internal.mjs';
export function browserBuild(packagePath, { release = true } = {}) {
  if (process.platform === 'win32') return build(packagePath, { release, wasm: true });
  const which = name => name.includes('/') ? resolve(root, name) :
    (process.env.PATH ?? '').split(delimiter).map(directory => resolve(root, directory, name)).find(existsSync);
  let clang = process.env.SILK_CLANG && which(process.env.SILK_CLANG);
  if (process.env.SILK_CLANG && !clang) throw new Error(`Cannot find SILK_CLANG executable: ${process.env.SILK_CLANG}`);
  if (!process.env.SILK_CLANG) {
    const candidates = [which('clang-22'),
      ...(process.platform === 'darwin' ? ['/opt/homebrew/opt/llvm/bin/clang', '/usr/local/opt/llvm/bin/clang'] : []),
      which('clang')];
    clang = candidates.find(path => {
      if (!path) return false;
      const version = spawnSync(path, ['--version'], { encoding: 'utf8' });
      return version.status === 0 && Number(version.stdout.match(/clang version (\d+)\./)?.[1]) >= 22;
    });
  }
  if (!clang) throw new Error('LLVM 22 or newer was not found. Install LLVM 22 or set SILK_CLANG to its clang executable.');
  // Bind an absolute executable: Silk filters compiler subprocess environments.
  const wrapper = resolve(root, '.cache/browser-clang/clang');
  mkdirSync(dirname(wrapper), { recursive: true });
  const quoted = `'${clang.replaceAll("'", "'\\''")}'`;
  writeFileSync(wrapper, `#!/bin/sh\nfor arg do\n  case "$arg" in -c|-S|-E|-v|--version) exec ${quoted} "$@";; esac\ndone\nexec ${quoted} "$@" -Wl,-z,stack-size=8388608\n`, { mode: 0o755 });
  return build(packagePath, { release, wasm: true, clang: wrapper });
}
