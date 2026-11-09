import { spawnSync } from 'node:child_process';
import { mkdirSync, rmSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { build, root } from './internal.mjs';
import { start, stop, until } from './native-run.mjs';
export const work = resolve(root, '.cache/ui-inspect');
export const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
export function expect(condition, description) {
  if (!condition) throw new Error(description);
  console.log(`ok: ${description}`);
}
export function json(result) {
  expect(result.status === 0, `inspector command: ${result.stderr || result.stdout}`);
  return JSON.parse(result.stdout);
}
export function picture(path) {
  expect(readFileSync(path).subarray(0, 8).equals(png), `PNG screenshot: ${path}`);
}
export async function program(name, binary, args, env, cli) {
  mkdirSync(work, { recursive: true });
  const socket = resolve(work, `${name}.sock`);
  rmSync(socket, { force: true });
  const child = start(binary, args, { ...env, SILK_UI_INSPECT: socket });
  const command = (...args) => {
    const result = spawnSync(cli, ['--connect', socket, ...args], { cwd: root, env, encoding: 'utf8', timeout: 60000, maxBuffer: 32 * 1024 * 1024 });
    if (result.error) throw result.error;
    return result;
  };
  try { await until(() => command('hello').status === 0, `${name} inspector`, 120000, child); }
  catch (error) { await stop(child); throw error; }
  return { child, socket, command, close: () => stop(child) };
}
export function inspectorCLI() { return build('modules/inspect/cli'); }
