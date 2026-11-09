import { resolve } from 'node:path';
import { build, root } from './internal.mjs';
export function browserBuild(packagePath, { release = true } = {}) {
  if (process.platform === 'win32') return build(packagePath, { release, wasm: true });
  process.env.SILK_REAL_CLANG = process.env.SILK_CLANG || 'clang';
  return build(packagePath, { release, wasm: true, clang: resolve(root, 'scripts/wasm-clang') });
}
