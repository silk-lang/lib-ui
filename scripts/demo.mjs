import { build } from './internal.mjs';
import { checkWindow, execute } from './native-run.mjs';
export async function demo(packagePath, args = process.argv.slice(2), defaultRelease = false) {
  const flags = new Set(args);
  const backendIndex = args.indexOf('--backend');
  const backend = backendIndex >= 0 ? args[backendIndex + 1] : 'all';
  const check = flags.has('check') || flags.has('--check');
  const binary = build(packagePath, { release: !flags.has('--debug') && (defaultRelease || flags.has('--release')) });
  if (flags.has('--build-only')) { console.log(binary); return; }
  if (check) return checkWindow(binary, backend);
  const forwarded = args.filter((arg, index) => !['run', '--release', '--debug', '--build-only', '--backend'].includes(arg) && !(backendIndex >= 0 && index === backendIndex + 1));
  await execute(binary, forwarded, undefined, 2147483647);
}
