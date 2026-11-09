import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
function* manifests(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory() && !['build', '.cache', '.git'].includes(entry.name)) yield* manifests(resolve(directory, entry.name));
    else if (entry.isFile() && entry.name === 'silk.toml') yield resolve(directory, entry.name);
  }
}
// Public runtime payload lookup: Silk fetches the exact revisions declared by the packages.
export function repositoryRoot(name) {
  if (!/^lib-[a-z]+$/.test(name)) throw new Error(`Invalid dependency repository: ${name}`);
  const url = `https://github.com/silk-lang/${name}.git`;
  const revisions = new Set();
  for (const manifest of manifests(resolve(root, 'modules'))) {
    for (const line of readFileSync(manifest, 'utf8').split('\n')) {
      if (!line.includes(`git = "${url}"`)) continue;
      const revision = line.match(/\brev\s*=\s*"([0-9a-f]{40})"/)?.[1];
      if (!revision) throw new Error(`Unpinned dependency in ${manifest}`);
      revisions.add(revision);
    }
  }
  if (revisions.size !== 1) throw new Error(`Expected one ${name} revision, found ${[...revisions]}`);
  const checkout = resolve(process.env.SILK_HOME || resolve(homedir(), '.silk'), 'git', [...revisions][0]);
  if (!existsSync(resolve(checkout, 'silk.toml'))) throw new Error(`Missing fetched ${name}: ${checkout}; run silk check --manifest-path ${resolve(root, 'modules/tree/window/silk.toml')}`);
  return checkout;
}
