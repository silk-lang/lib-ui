import { build, run } from './internal.mjs';
run(process.execPath, ['ui/text/scripts/chrome-text.mjs', '--cli', build('ui/text/tools/cli')]);
run(process.execPath, ['ui/tree/scripts/test-browser']);
run(process.execPath, ['ui/tree/window/scripts/browser', 'test', 'ui/tree/window/demo', '--', '--size', '400,250', '--click', '90,35']);
