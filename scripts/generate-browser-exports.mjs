import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { root } from './internal.mjs';
import { repositoryRoot } from './dependency-root.mjs';
const template = readFileSync(resolve(repositoryRoot('lib-native'), 'modules/gpu/webgpu/browser/generated_webgpu_exports.silk'), 'utf8');
for (const path of ['modules/tree/browser', 'modules/tree/window/demo']) {
  const destination = resolve(root, path, 'src/generated_webgpu_exports.silk');
  if (process.argv.includes('--check')) {
    if (readFileSync(destination, 'utf8') !== template) throw new Error('Stale browser exports: ' + destination);
  } else writeFileSync(destination, template);
}
