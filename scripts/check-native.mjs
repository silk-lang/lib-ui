import { build, run } from './internal.mjs';
import { checkWindow } from './native-run.mjs';
const index = process.argv.indexOf('--backend');
const backend = index < 0 ? 'all' : process.argv[index + 1];
for (const member of ['modules/tree/demo', 'modules/app/demo', 'modules/components/demo', 'modules/tree/window/demo']) await checkWindow(build(member, { release: true }), backend);
run(process.execPath, ['modules/tree/demo/scripts/demo', 'inspect']);
run(process.execPath, ['modules/tree/demo/scripts/demo', 'mcp']);
run(process.execPath, ['modules/inspect/devtools/scripts/devtools', 'check']);
