// Native package tests and golden runners, including every workspace member.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { root, silk, run, build, prepareWindows } from './internal.mjs';
const members = [...readFileSync(resolve(root, 'silk.toml'), 'utf8').matchAll(/^\s*"(ui\/[^"]+)",?\s*$/gm)].map(match => match[1]);
for (const member of members) run(silk, ['check', '--manifest-path', `${member}/silk.toml`]);
if (process.platform === 'win32') prepareWindows();
for (const member of ['modules/text', 'modules/sprites', 'modules/tree/tests', 'modules/tree/window/tests', 'modules/app/tests', 'modules/app/window/tests', 'modules/components/tests', 'modules/inspect/tests', 'modules/inspect/server/tests', 'modules/inspect/devtools/tests']) {
  run(silk, ['test', '--manifest-path', `${member}/silk.toml`, '--root', 'src/tests.silk']);
}
run(process.execPath, ['modules/app/window/tests/http-test']);
for (const member of ['modules/tree/tests', 'modules/app/tests', 'modules/components/tests', 'modules/inspect/tests', 'modules/inspect/devtools/tests']) {
  run(build(member), [`${member}/goldens`]);
}
for (const member of ['modules/text/tools/cli', 'modules/inspect/cli', 'modules/inspect/mcp']) build(member);
for (const member of ['modules/text', 'modules/sprites', 'modules/tree', 'modules/app', 'modules/app/examples', 'modules/components', 'modules/components/gallery', 'modules/inspect', 'modules/inspect/devtools']) {
  run(silk, ['check', '--manifest-path', `${member}/silk.toml`, '--target', 'wasm32-unknown-unknown']);
}
run(process.execPath, ['modules/assets/scripts/embed-assets', '--check']);
run(process.execPath, ['scripts/generate-browser-exports.mjs', '--check']);
