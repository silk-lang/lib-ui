# ui-bench-web

The keyed [js-framework-benchmark](https://github.com/krausest/js-framework-benchmark) entry for
Silk UI in a page: a ui-app program (`src/main.silk`) shown with real DOM nodes by
[ui-app-dom](../../app/dom), compiled to WebAssembly. It builds the markup every entry builds (the
Bootstrap jumbotron with six buttons, a table of rows with `tr`, `td`, `a` and the `danger` class
on the selected row) with `h.element`, `h.className` and `h.id`, so the page's stylesheet and the
driver's selectors apply as they do to the other entries.

It is not run on CI: a full run takes about an hour. To run it locally:

```sh
git clone --depth 1 https://github.com/krausest/js-framework-benchmark.git jfb
(cd jfb && npm ci --legacy-peer-deps --ignore-scripts && npm run install-server)
(cd jfb/webdriver-ts && npm ci --legacy-peer-deps && npm run compile)
modules/bench/web/build.sh jfb            # writes jfb/frameworks/keyed/silk-ui
(cd jfb/server && npm start) &            # serves http://localhost:8080
cd jfb/webdriver-ts
node dist/benchmarkRunner.js --headless --count 5 --framework keyed/silk-ui keyed/vanillajs \
  --benchmark 01_ 02_ 03_ 04_ 05_ 06_ 07_ 08_ 09_
```

Results land in `jfb/webdriver-ts/results`. The reference frameworks need their own build first
(`npm ci && npm run build-prod` in `jfb/frameworks/keyed/<name>`). Running as root, Chromium also
needs `--no-sandbox` in `webdriver-ts/src/puppeteerAccess.ts`; `--chromeBinary` points the driver at
a Chromium of your own.

`OPTIMIZATION=size modules/bench/web/build.sh jfb` builds the smaller WebAssembly instead of the
faster one.
