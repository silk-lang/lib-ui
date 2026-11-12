# Silk UI

Standalone retained UI, application framework, components, native/browser hosts, and inspection tools for Silk.

## Documentation

The guides live in [`docs/`](docs/README.md) and are published from `main`. There are three:
Silk UI (the framework), native apps, and the UI tree. Every example in them is a real
program under `docs/examples`, tested by `docs/tests`.

```sh
docs/build.sh serve   # builds the site and serves it on http://localhost:8017
```

## Run a demo locally

Run commands from the **lib-ui repository root**, including when using a Git worktree.
The demo launcher builds the selected executable and opens its window; no workspace-wide
build or sibling repository checkout is needed.

With the Silk launcher (`silk`) installed, first install the compiler selected by `silk.toml`:

```sh
silk use
```

`silk update self` updates the launcher, not the compiler selected by this workspace.
If you see “workspace silk-version … is not installed”, run `silk use` in this checkout.

On **Apple Silicon macOS 26+**, use LLVM 22, its matching LLD, and the Xcode/macOS SDK.
For the versioned Homebrew toolchain, run these in the same terminal:

```sh
export SILK_CLANG=/opt/homebrew/opt/llvm@22/bin/clang
export PATH="/opt/homebrew/opt/lld@22/bin:$PATH"
export SDKROOT="$(xcrun --sdk macosx --show-sdk-path)"
"$SILK_CLANG" --version # must report clang 22, not Apple clang
silk task native demo modules/app/demo
```

Change `SILK_CLANG` if LLVM 22 is installed elsewhere. `SDKROOT` matters for CPU-only tools
and test executables too: without it, Silk dev.63 can use system-library stubs missing
`tanf`, `cosf`, `sinf` and `hypotf`, causing `ld64.lld: undefined symbol` errors.

On **Linux**, install LLVM 22 and the X11, xkbcommon, Wayland and wayland-protocols
development packages, set `SILK_CLANG` to the absolute LLVM 22 clang path, then run the
same demo command from a graphical desktop. Windows package builds require an x64 Visual
Studio developer environment and LLVM 22; managed native/browser task execution is blocked
by [silk#3034](https://github.com/silk-lang/silk/issues/3034), with no legacy-script fallback.

| Demo | Interactive command |
| --- | --- |
| Todo application | `silk task native demo modules/app/demo` |
| Components gallery | `silk task native demo modules/components/demo` |
| Retained tree inbox | `silk task native demo modules/tree/demo` |
| Retained tree editor | `silk task native demo modules/tree/demo -- --editor` |
| Small window/counter | `silk task native demo modules/tree/window/demo` |
| Todo with inspector/devtools | `silk task native devtools todo` |
| Todo with devtools in its own process | `silk build --manifest-path modules/app/demo/silk.toml`, then `SILK_UI_DEVTOOLS=window` (or `dock`) `build/llvm/<target>/debug/ui-app-demo`; F12 toggles them |

Close the window to return to the terminal. The first build fetches pinned dependencies
and prepares native libraries through Silk's manifest hooks.

For the small counter in Chrome/Edge with WebGPU and JSPI (137+), run
`silk task browser serve` and open the URL printed by the server.
Keep the server running; Ctrl+C stops it. Neither serving nor checks require Playwright.
Set `SILK_CLANG` to LLVM 22 before building. Browser checks use native Chromium through CDP;
set `CHROMIUM_EXECUTABLE` to select its executable.

`silk build` builds the workspace, including CLI tools, test executables and maintenance tasks;
it does **not** launch a demo. Commands containing `check`/`test` are automated verification.
`silk task setup-ci` provisions hosted CI; it is not local shell setup.

### Studio design editor

Studio lives in [julia-script/silk-studio](https://github.com/julia-script/silk-studio).
Follow its setup instructions, then run from the **silk-studio repository root**:

- Desktop: `node scripts/studio --release`
- Browser: `node scripts/browser serve`, then open <http://127.0.0.1:8050/> in Chrome/Edge 137+.

### Applications in nonstd

The other full applications live in [silk-lang/nonstd](https://github.com/silk-lang/nonstd),
not in this repository. Open or clone that repository, follow its
[local setup](https://github.com/silk-lang/nonstd#run-an-application-locally), and run
these commands from the **nonstd repository root**:

| Application | Native launch command |
| --- | --- |
| [Notes](https://github.com/silk-lang/nonstd/tree/main/examples/notes) | `node examples/notes/scripts/notes` |
| [Scroll Lab](https://github.com/silk-lang/nonstd/tree/main/examples/scroll-demo) | `node examples/scroll-demo/scripts/run` |
| [Silk Loom showcase](https://github.com/silk-lang/nonstd/tree/main/examples/showcase) | `node examples/showcase/scripts/app` |
| [Graphics Demo](https://github.com/silk-lang/nonstd/tree/main/examples/graphics-demo) | `node examples/graphics-demo/scripts/app` |

### Strict checks

Keep compiler warnings enabled and fix them. Remove genuinely unused imports and bindings.
Imports that register tests or browser C/wasm exports must retain that behavior; use explicit
intentional module bindings, not warning suppression or removal of test/browser coverage.

## Provenance and toolchains

Extracted without removing UI packages, fixtures, goldens, demos, inspector tools, or browser surfaces from `silk-lang/nonstd` commit `7d6c3693a9ad1fec24127985626ab4224f9f1995`. Packages live under `modules/`; public package names and import namespaces are unchanged. Applications such as Notes, Studio, Scroll Lab, Showcase, and Graphics Demo live in the application repositories linked above; they are consumers, not dependencies of this repository.

Use Silk **0.1.0-dev.69+366225ca4dc5** and LLVM **22.1.8**. `silk.toml` pins Silk; the official launcher installs and verifies that release. Repository maintenance uses typed, cached `silk task` commands. Browser runtime JavaScript remains runtime code, not task orchestration.

Hosted CI bootstraps Clang and the pinned Silk release before running any compiled task. The official installer is pinned to the compiler commit. `silk task setup-ci` invokes the exact native dependency's tasks; `--linux-gpu` provisions lavapipe and `--browser` selects Chromium. There are no old script entrypoints or Playwright compatibility aliases.

WebAssembly builds select an 8 MiB stack declaratively; no generated shell compiler wrapper is needed. No CI provisioning command is needed to serve a browser demo.

Linux native compilation needs X11, xkbcommon, Wayland, and wayland-protocols development headers; window checks additionally need Xvfb, xauth, Weston, and Vulkan/lavapipe. Windows native builds require the x64 Visual Studio developer environment and Windows SDK. macOS requires Apple Silicon macOS 26+ and `SDKROOT` set to `xcrun --sdk macosx --show-sdk-path`. Managed integration checks currently run on macOS/Linux; Windows lifecycle support is tracked in #3034.

Silk **0.1.0-dev.63+657e3c900f65** fixes Windows Git command paths and the launcher's
`SILK_HOME` representation ([silk#3025](https://github.com/silk-lang/silk/issues/3025)).
Tasks invoke the compiler selected by Silk through `Task.silk`; no direct compiler bypass
or relaxed Git NTFS protection is required.

Golden images include the corrected graphics border rasterization: underline-only tabs no
longer paint phantom side edges, and rounded border corners use opposite-winding contours.
Layout/text references and pixel tolerances are unchanged.

## Package boundaries

All 31 original UI workspace packages remain members of `silk.toml`:

| Role | Package paths |
| --- | --- |
| Consumable text and assets | `modules/text`, `modules/sprites`, `modules/assets` |
| Retained tree and platform hosting | `modules/tree`, `modules/tree/window` |
| Application framework and components | `modules/app`, `modules/app/window`, `modules/components` |
| Inspection APIs | `modules/inspect`, `modules/inspect/server`, `modules/inspect/devtools` |
| Reusable demo/fixture libraries | `modules/app/examples`, `modules/components/gallery`, `modules/tree/fixtures` |
| Developer applications (not library APIs) | `modules/app/demo`, `modules/components/demo`, `modules/tree/demo`, `modules/tree/window/demo`, `modules/inspect/devtools/app` |
| Developer protocol and comparison executables | `modules/inspect/cli`, `modules/inspect/mcp`, `modules/text/tools/cli`, `modules/tree/browser` |
| Tests and golden runners (not library APIs) | `modules/app/tests`, `modules/app/window/tests`, `modules/components/tests`, `modules/inspect/tests`, `modules/inspect/server/tests`, `modules/inspect/devtools/tests`, `modules/tree/tests`, `modules/tree/window/tests` |

The manifests explicitly export consumable modules. Test-only packages declare their test module as the library entrypoint rather than inventing a runnable application. CLI executables and demos are developer tools, not dependencies of the API packages. Shared scenes, CPU/GPU rendering, vector graphics, codecs, and atlases remain in `lib-graphics`; native windows and WebGPU in `lib-native`; layout/styles in `lib-css`; parsing/shaping/rasterization in `lib-fonts`; SVG parsing/rendering in `lib-svg`. None are copied into this repository.

UI-to-UI dependencies stay local. External dependencies use canonical `https://github.com/silk-lang/lib-NAME.git` URLs with exact 40-character revisions and package paths. Consumers must use these same revisions throughout their graph: Silk does not accept two physical checkouts of one named package.

## Building and checking

From this repository root, with the toolchain on `PATH`:

```sh
silk check --manifest-path modules/tree/window/silk.toml # serial first Git fetch
silk check --workspace
silk build --manifest-path modules/inspect/cli/silk.toml
silk task check
silk task native check
silk task browser check
```

Standalone maintenance tasks need neither Node nor a sibling checkout:

```sh
silk task
silk task check-packages
silk task unit-tests
silk task goldens
silk task build-tools
silk task embed-assets --check
silk task generate-browser-exports --check
```

Windows managed-process tasks are blocked by [silk#3034](https://github.com/silk-lang/silk/issues/3034): the standard library does not expose live child pipes, exit observation, and termination there. These tasks report the unsupported capability; duplicate Python/Node implementations are not retained.

`check` checks every workspace package, all ten UI unit-test roots, the loopback HTTP image test, five describe/PNG golden runners, the text/inspector/MCP CLIs, portable wasm APIs, and generated-file freshness. It does not update goldens. `native check` runs five rendering/input scenarios (the mirror example opens a second window) plus socket inspector, MCP, devtools and same-process devtools interactions. Linux runs X11 and Wayland (`--backend x11` or `--backend wayland` selects one). `browser check` compares Chrome text, browser fixture trees, and the counter's real input.

Individual entrypoints remain available:

```sh
silk task native demo modules/app/demo
silk task native demo modules/components/demo -- check --release
silk task native demo modules/tree/demo -- --editor
silk task native inspect
silk task native mcp
silk task native demo modules/tree/window/demo -- --check
silk task native devtools todo
silk task native devtools check
silk task native devtools embedded
silk task native devtools --connect 1
silk task browser serve
silk task browser test --width 400 --height 250 --click --click-x 90 --click-y 35
```

The devtools check drives the owned todo demo: live element discovery, selection/highlighting, style declarations, box model, input/event logging, changed tree content, and screenshots of both windows. Notes-specific persistence remains an application-repository check. Use `silk task native devtools external --app-binary PATH [--app-args ARG ...]` for an already-built application, or `--connect ADDRESS` for an existing process. `devtools embedded` (part of `native check`) opens the devtools in the todo demo's own process, in a window and then docked, and checks through the socket inspector that it still sees the app alone, with the devtools' root hidden.

## Runtime resources and published browser payloads

No sibling checkout is needed. `src/task_support.silk` resolves external payloads from the exact Git revisions in UI manifests to `$SILK_HOME/git/<revision>` (default `~/.silk/git/<revision>`), rejecting missing or inconsistent pins. Run Silk first so the dependency checkout exists.

These paths are supported payloads for applications using the published Git revision:

- `modules/tree/window/browser/app-host.js` and `index.html` are browser runtime payloads.
- `silk task browser browser-tree-server --wasm APP.wasm --port 8050` serves an externally compiled module.
- `silk task browser parity [--only NAME] [--within PIXELS] [--chrome PATH]` replays the tree's parity cases in Chromium and lists where events, boxes, scrolling or focus differ (see modules/tree/README.md). Not part of `check`.
- `silk task browser test --package PACKAGE [--width W] [--height H] [--scale N] [--click --click-x X --click-y Y] [--typed TEXT] [--stored KEY] [--screenshot FILE]` builds and checks rendering, input, and optional localStorage/reload behavior.
- The page imports `/ui/tree/window/browser/app-host.js`; its imports retain `/native/platform/window/browser/window-host.js` and `/native/gpu/webgpu/browser/host.ts`. The server maps `/ui/tree/window/browser/` to this repository's `modules/tree/window/browser/`, and the two `/native/` prefixes to `modules/platform/window/browser/` and `modules/gpu/webgpu/browser/` in the manifest-pinned native checkout. Custom servers must provide the same distinct URL namespaces; `/modules/` is not a browser URL prefix.
- Browser application roots must import their own WebGPU export module, using the template `modules/gpu/webgpu/browser/generated_webgpu_exports.silk` from that same native revision and direct `webgpu`/`webgpu_sys` aliases. `silk task generate-browser-exports` refreshes the two owned roots; `--check` checks freshness. Silk browser tasks select an 8 MiB stack declaratively through the build profile.

UI fixture assets are owned under `modules/assets/assets` and embedded in `src/generated_assets.silk`. `silk task embed-assets [--check]` refreshes/checks them. `silk task generate-photos` authors procedural photos in Silk, using native ImageMagick 7 only for PNG/JPEG encoding; it is not a build dependency. Regeneration retains the scene geometry and formats but is not byte-identical to the previous Pillow renderer; existing committed photos are unchanged. Additional text-comparison fonts are owned under `modules/text/tests/fonts`; all Noto, Amiri, M+ and Roboto Flex OFL notices accompany their unchanged subset files. Unit tests and golden runners use repository-root working directories. Fonts/icons/photos needed by normal UI fixtures are embedded and do not depend on the working directory.

See [the UI guide](modules/README.md), [the framework](modules/app/README.md), [components](modules/components/README.md), and [inspection tools](modules/inspect/README.md).
