// Provision from the manifest-pinned native tooling, never a sibling checkout.
import { appendFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { root, silk, run } from './internal.mjs';
import { repositoryRoot } from './dependency-root.mjs';
run(silk, ['check', '--manifest-path', resolve(root, 'ui/tree/window/silk.toml')]);
run(process.execPath, [resolve(repositoryRoot('lib-native'), 'scripts/setup-ci.mjs'), ...process.argv.slice(2)]);
if (process.platform === 'darwin' && process.env.GITHUB_ENV) {
  const sdk = run('xcrun', ['--sdk', 'macosx', '--show-sdk-path'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] }).stdout.trim();
  appendFileSync(process.env.GITHUB_ENV, `SDKROOT=${sdk}\n`);
}
