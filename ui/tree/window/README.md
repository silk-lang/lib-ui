# ui-tree-window

## Shared native host

`host.runWindow` owns the native window, GPU surface, input adapter, accessibility
publication, inspector integration, frame requests, and presentation. It requires no
`ui-app` runtime. Implement `host.WindowClient<State, Errors, Requirements>` and pass
ordinary client state, a font collection, initial resource mutations, window options,
and an inspector. The app window package now adapts its existing runtime and custom
`WindowContent` hooks to this host.

Use `start` to create nodes with mutation batches and `pump` to consume tree events.
The default `layout` method calls `tree.frame`; clients that virtualize content must
reconcile range requests and settle another frame before it returns. `poll` collects
background work, `wakeAfter` bounds waits, and `nextDeadline` supplies timer deadlines
in seconds relative to host startup. `frame`, `scene`, and `draw` support custom GPU
composition. The host publishes accessibility geometry after client layout settles.

The [direct-tree counter](demo/src/main.silk) is a complete example with no app or
component framework dependency. From the repository root, with Node 22+:

    node ui/tree/window/demo/run
    node ui/tree/window/demo/run --check

The check dispatches a click and Tab through the real input path, verifies the
updated text, and compares GPU output with the CPU reference. `--debug` builds a
development binary; `--build-only` compiles without opening a window.
The default renderer and the check use a white window background. CPU snapshots
also expose `renderSceneOver` for reference rendering with an explicit clear color.

## In the browser

The same host runs in a browser tab: a wasm32 build of the program draws on a canvas through
`navigator.gpu`, with native/platform/window's browser backend for input and the input method.
From the repository root:

    node ui/tree/window/scripts/browser serve                       # the owned counter
    node ui/tree/window/scripts/browser serve /path/to/app/package
    node ui/tree/window/scripts/browser test ui/tree/window/demo -- --size 400,250 --click 90,35
    node ui/tree/window/browser/serve.mjs /path/to/compiled-app.wasm
    node ui/tree/window/browser/test.mjs --wasm /path/to/compiled-app.wasm --stored notes

`serve` builds the package for `wasm32-unknown-unknown` (release unless `--debug`) and prints
the page's address, by default http://127.0.0.1:8050/. It needs WebGPU and WebAssembly JSPI:
Chrome or Edge 137 or later. The server reads the module on each request, so after
`scripts/browser build` a reload shows the new build. Add `?check` to the address for the
rendering check of `--check`. `test` runs that check and then real input in the installed
Chromium (see [browser/test.mjs](browser/test.mjs) for its options).

How it differs from a native window:

- **One thread.** The host's loop runs in the module as it does natively. The page calls
  `main` through JSPI ([browser/app-host.js](browser/app-host.js)), so a wait for input
  suspends the module and gives the page its turn. Frames are drawn on the same thread by
  [render_inline.silk](src/render_inline.silk), which has `RenderThread`'s API; while WebGPU
  answers a request it yields to the page through the `silk_browser#yield` import. There is
  no platform thread and no compositor scroll: wheel scrolling goes through the tree.
- **The program brings its fonts and data.** There are no system fonts and no files; pass a
  bundled collection (for example `ui_fixtures.fixtures.fonts()`) to `runWindow`. The
  inspector is always off.
- **Text the app keeps goes to localStorage.** `browser.store(key, text)` keeps it and
  `browser.stored(key)` reads it back on the next visit (both do nothing natively). The page
  puts `silk-app:` before each key, and gives the app no storage in check mode, so a check
  always starts from nothing.
- **An 8 MiB stack.** The compiler links wasm with a 1 MiB stack, which deep layouts overflow
  (the trap reads "memory access out of bounds"), so `scripts/browser` links through a clang
  wrapper that asks for 8 MiB on POSIX; Windows retains the compiler's default.
- **`main` takes no arguments.** Read `browser.checkRequested()` for `?check`, and print with
  `console.StderrWriter`: standard error natively, the browser console in the page.
- **Two modules in the program's own package.** A dependency exports no wasm symbols, so the
  program's package holds `generated_webgpu_exports.silk` (copied from the manifest-pinned
  `lib-native/native/gpu/webgpu/browser` payload) and `libm.silk`,
  and imports both under `static if Intrinsic.targetArchitecture() == "wasm32"`. See
  [demo/src/main.silk](demo/src/main.silk) and
  [examples/notes/browser](https://github.com/silk-lang/nonstd/tree/7d6c3693a9ad1fec24127985626ab4224f9f1995/examples/notes/browser/src/main.silk).

To put an app on another page, serve the module with `app-host.js` and the two hosts it
imports, and call `runApp({ wasm, container })`.

The server resolves native payloads from `$SILK_HOME/git/<revision>`, as declared in the UI
manifests. No sibling source checkout is required. See the root README for stable virtual URL
prefixes and the public payload contract. `node scripts/generate-browser-exports.mjs`
refreshes the two owned export modules; `--check` compares them with the pinned template.

## Background images

`images.Images` queues file or HTTP(S) requests, decodes on native workers, installs
completed pixels in `UiTree`, and exposes loading/error states. Call `poll` from the
host loop while `pending()` is true. Replacement and cancellation reject stale
results. `release` cancels work and releases the installed resource. The request state
and generation checks come from portable `ui-tree.image_load` code; OS threads and
I/O stay in this native package.

`background.Background` and `Cancellation` are also available without `ui-app`.
Work and results must own transferable storage. Keep cancelled jobs until completion:
dropping an unfinished job joins the worker. Compatibility imports remain available
under `ui-app-window.background` and `ui-app-window.images`.

## Extraction validation

Validated on macOS arm64 with the pinned compiler: 31 tree tests, 11 app tests,
16 component tests, 5 inspector tests, and the native image-worker test pass.
Tree, inspector, app, and component goldens pass against current `main`. Tree tests cover crop
reuse, idle refinement, atlas eviction, and anchored popup placement.

The direct-tree counter passes its scripted input and CPU/GPU comparison. The
10,000-section scroll demo passes both its normal and growing-content GPU checks.
Core tree and app code check for wasm32. CPU scroll measurements are recorded in
[shared-primitives.json](https://github.com/silk-lang/nonstd/tree/7d6c3693a9ad1fec24127985626ab4224f9f1995/examples/scroll-demo/measurements/shared-primitives.json);
they exclude GPU work and presentation.
