import { build, run } from './internal.mjs';
run(process.execPath, ['modules/text/scripts/chrome-text.mjs', '--cli', build('modules/text/tools/cli')]);
run(process.execPath, ['modules/tree/scripts/test-browser']);
run(process.execPath, ['modules/tree/window/scripts/browser', 'test', 'modules/tree/window/demo', '--', '--size', '400,250', '--click', '90,35']);
