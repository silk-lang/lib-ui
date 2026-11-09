import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { build, root } from './internal.mjs';
export function browserBuild(packagePath, { release = true } = {}) {
  if (process.platform === 'win32') return build(packagePath, { release, wasm: true });
  const clang = process.env.SILK_CLANG;
  if (!clang) throw new Error('Set SILK_CLANG to LLVM 22 clang (scripts/setup-ci.mjs configures it)');
  // Silk deliberately filters tool environments; bind the compiler path into the wrapper.
  const wrapper = resolve(root, '.cache/browser-clang/clang');
  mkdirSync(dirname(wrapper), { recursive: true });
  const quoted = `'${clang.replaceAll("'", "'\\''")}'`;
  writeFileSync(wrapper, `#!/bin/sh\nfor arg do\n  case "$arg" in -c|-S|-E|-v|--version) exec ${quoted} "$@";; esac\ndone\nexec ${quoted} "$@" -Wl,-z,stack-size=8388608\n`, { mode: 0o755 });
  return build(packagePath, { release, wasm: true, clang: wrapper });
}
