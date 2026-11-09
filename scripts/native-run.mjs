import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { setTimeout as delay } from 'node:timers/promises';
import { root } from './internal.mjs';
export { delay };
export function environment() {
  const env = { ...process.env };
  delete env.SILK_UI_INSPECT;
  delete env.SILK_WINDOW_FIBER;
  if (process.platform === 'linux') {
    if (!env.VK_ICD_FILENAMES && existsSync('/usr/share/vulkan/icd.d/lvp_icd.json')) env.VK_ICD_FILENAMES = '/usr/share/vulkan/icd.d/lvp_icd.json';
    env.SILK_WINDOW_SCALE ??= '1';
  }
  return env;
}
export function start(command, args = [], env = environment(), stdio = 'inherit') {
  const child = spawn(command, args, { cwd: root, env, stdio });
  child.failure = null;
  child.on('error', error => { child.failure = error; });
  return child;
}
export async function stop(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null || child.failure) return;
  const exited = new Promise(resolve => child.once('exit', resolve));
  child.kill();
  const timer = setTimeout(() => child.kill('SIGKILL'), 10000);
  try { await exited; } finally { clearTimeout(timer); }
}
export async function until(check, description, timeout = 10000, child) {
  const deadline = Date.now() + timeout;
  while (true) {
    if (await check()) return;
    if (child?.failure) throw child.failure;
    if (child && (child.exitCode !== null || child.signalCode !== null)) throw new Error(`${description}: process exited`);
    if (Date.now() >= deadline) throw new Error(`Timed out: ${description}`);
    await delay(100);
  }
}
export async function execute(command, args = [], env = environment(), timeout = 300000) {
  const child = start(command, args, env);
  const timer = setTimeout(() => child.kill('SIGKILL'), timeout);
  try {
    const code = await new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', (code, signal) => signal ? reject(new Error(`${command}: ${signal}`)) : resolve(code)); });
    if (code !== 0) throw new Error(`${command} exited ${code}`);
  } finally { clearTimeout(timer); await stop(child); }
}
export async function withDisplay(backend, action) {
  const env = environment();
  if (process.platform !== 'linux') return action(env);
  if (!['x11', 'wayland'].includes(backend)) throw new Error(`Unknown backend: ${backend}`);
  env.SILK_WINDOW_BACKEND = backend;
  let server, runtime;
  try {
    if (backend === 'x11') {
      delete env.WAYLAND_DISPLAY;
      let number = 90;
      while (existsSync(`/tmp/.X11-unix/X${number}`) || existsSync(`/tmp/.X${number}-lock`)) number++;
      env.DISPLAY = `:${number}`;
      server = start('Xvfb', [env.DISPLAY, '-screen', '0', '1600x1000x24', '-nolisten', 'tcp'], env);
      await until(() => existsSync(`/tmp/.X11-unix/X${number}`), 'Xvfb socket', 10000, server);
    } else {
      runtime = mkdtempSync(resolve(tmpdir(), 'silk-ui-weston-'));
      env.XDG_RUNTIME_DIR = runtime;
      env.WAYLAND_DISPLAY = 'silk-ui';
      delete env.DISPLAY;
      server = start('weston', ['--backend=headless', '--socket=silk-ui', '--width=1600', '--height=1000', '--idle-time=0'], env);
      await until(() => existsSync(resolve(runtime, 'silk-ui')), 'Weston socket', 10000, server);
    }
    return await action(env);
  } finally {
    await stop(server);
    if (runtime) rmSync(runtime, { recursive: true, force: true });
  }
}
export async function checkWindow(binary, backend = 'all', args = ['--check']) {
  if (!['all', 'x11', 'wayland'].includes(backend)) throw new Error(`Unknown backend: ${backend}`);
  for (const name of process.platform === 'linux' && backend === 'all' ? ['x11', 'wayland'] : [backend === 'all' ? 'x11' : backend]) {
    console.log(`Window check: ${name}`);
    await withDisplay(name, env => execute(binary, args, env));
  }
}
