// Native package tests and golden runners, including every workspace member.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { root, silk, run, build, prepareWindows } from './internal.mjs';
const members = [...readFileSync(resolve(root, 'silk.toml'), 'utf8').matchAll(/^\s*"(ui\/[^"]+)",?\s*$/gm)].map(match => match[1]);
for (const member of members) run(silk, ['check', '--manifest-path', `${member}/silk.toml`]);
if (process.platform === 'win32') prepareWindows();
for (const member of ['ui/text', 'ui/sprites', 'ui/tree/tests', 'ui/tree/window/tests', 'ui/app/tests', 'ui/app/window/tests', 'ui/components/tests', 'ui/inspect/tests', 'ui/inspect/server/tests', 'ui/inspect/devtools/tests']) {
  run(silk, ['test', '--manifest-path', `${member}/silk.toml`, '--root', 'src/tests.silk']);
}
run(process.execPath, ['ui/app/window/tests/http-test']);
for (const member of ['ui/tree/tests', 'ui/app/tests', 'ui/components/tests', 'ui/inspect/tests', 'ui/inspect/devtools/tests']) {
  run(build(member), [`${member}/goldens`]);
}
for (const member of ['ui/text/tools/cli', 'ui/inspect/cli', 'ui/inspect/mcp']) build(member);
for (const member of ['ui/text', 'ui/sprites', 'ui/tree', 'ui/app', 'ui/app/examples', 'ui/components', 'ui/components/gallery', 'ui/inspect', 'ui/inspect/devtools']) {
  run(silk, ['check', '--manifest-path', `${member}/silk.toml`, '--target', 'wasm32-unknown-unknown']);
}
run(process.execPath, ['ui/assets/scripts/embed-assets', '--check']);
run(process.execPath, ['scripts/generate-browser-exports.mjs', '--check']);
