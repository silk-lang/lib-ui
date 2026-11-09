import { build, run } from './internal.mjs';
import { checkWindow } from './native-run.mjs';
const index = process.argv.indexOf('--backend');
const backend = index < 0 ? 'all' : process.argv[index + 1];
for (const member of ['ui/tree/demo', 'ui/app/demo', 'ui/components/demo', 'ui/tree/window/demo']) await checkWindow(build(member, { release: true }), backend);
run(process.execPath, ['ui/tree/demo/scripts/demo', 'inspect']);
run(process.execPath, ['ui/tree/demo/scripts/demo', 'mcp']);
run(process.execPath, ['ui/inspect/devtools/scripts/devtools', 'check']);
