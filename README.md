# Silk UI

Standalone retained UI, application framework, components, native/browser hosts, and inspection tools for Silk.

## Provenance and toolchains

Extracted without removing UI packages, fixtures, goldens, demos, inspector tools, or browser surfaces from `silk-lang/nonstd` commit `7d6c3693a9ad1fec24127985626ab4224f9f1995`. The original `ui/...` package paths are preserved. Applications such as Notes, Studio, Scroll Lab, Showcase, and Graphics Demo remain in their application repository; they are consumers, not dependencies of this repository.

Use Silk **0.1.0-dev.61+91f335268900**, LLVM **22.1.8**, and Node **22+**. `toolchains.lock.json` pins downloadable toolchains and their checksums. Silk performs compilation, package resolution, native archive preparation, and package generation directly. Node orchestrates processes, HTTP/browser fixtures, and inspection protocols; Windows native preparation uses PowerShell from the pinned `lib-native` payload. No normal build, test, or run command invokes Python.

For hosted CI, `node scripts/install-silk.mjs` installs the pinned compiler and adds its bin directory to `GITHUB_PATH` (locally it prints the directory to add to `PATH`). Then `node scripts/setup-ci.mjs` resolves the native dependency and provisions its pinned tools. `--linux-gpu` provisions lavapipe; `--browser` selects an existing Chromium and installs pinned Playwright JavaScript without downloading a browser. Local browser runners use `PLAYWRIGHT_MODULE`, `PLAYWRIGHT_CHROMIUM_EXECUTABLE`, and `CHROME_PATH` when supplied. Set `SILK` to override the Silk executable and `SILK_CLANG` for LLVM 22 clang.

The WebAssembly stack wrapper selects `SILK_REAL_CLANG`, then `SILK_CLANG`, then `clang` on `PATH`.

Linux native compilation needs X11, xkbcommon, Wayland, and wayland-protocols development headers; window checks additionally need Xvfb, xauth, Weston, and Vulkan/lavapipe. Windows requires the x64 Visual Studio 2026 developer environment, Windows SDK and PowerShell 7. macOS requires Apple Silicon macOS 26+ and `SDKROOT` set to `xcrun --sdk macosx --show-sdk-path`. The checked-in CI exercises native package checks and rendering/inspection on Linux, macOS, and Windows, plus browser checks on Linux.

On Windows the repository runners invoke the installed `silkc.exe` directly (override with
`SILK`). The pinned `silk.exe` launcher exports `SILK_HOME` in an encoding its compiler's Git
cache parser rejects. Direct compiler invocation preserves native `SILK_HOME` overrides and
the default `USERPROFILE` cache location.

Golden images include the corrected graphics border rasterization: underline-only tabs no
longer paint phantom side edges, and rounded border corners use opposite-winding contours.
Layout/text references and pixel tolerances are unchanged.

## Package boundaries

All 31 original UI workspace packages remain members of `silk.toml`:

| Role | Package paths |
| --- | --- |
| Consumable text and assets | `ui/text`, `ui/sprites`, `ui/assets` |
| Retained tree and platform hosting | `ui/tree`, `ui/tree/window` |
| Application framework and components | `ui/app`, `ui/app/window`, `ui/components` |
| Inspection APIs | `ui/inspect`, `ui/inspect/server`, `ui/inspect/devtools` |
| Reusable demo/fixture libraries | `ui/app/examples`, `ui/components/gallery`, `ui/tree/fixtures` |
| Developer applications (not library APIs) | `ui/app/demo`, `ui/components/demo`, `ui/tree/demo`, `ui/tree/window/demo`, `ui/inspect/devtools/app` |
| Developer protocol and comparison executables | `ui/inspect/cli`, `ui/inspect/mcp`, `ui/text/tools/cli`, `ui/tree/browser` |
| Tests and golden runners (not library APIs) | `ui/app/tests`, `ui/app/window/tests`, `ui/components/tests`, `ui/inspect/tests`, `ui/inspect/server/tests`, `ui/inspect/devtools/tests`, `ui/tree/tests`, `ui/tree/window/tests` |

The manifests explicitly export consumable modules. Test-only packages declare their test module as the library entrypoint rather than inventing a runnable application. CLI executables and demos are developer tools, not dependencies of the API packages. Shared scenes, CPU/GPU rendering, vector graphics, codecs, and atlases remain in `lib-graphics`; native windows and WebGPU in `lib-native`; layout/styles in `lib-css`; parsing/shaping/rasterization in `lib-fonts`; SVG parsing/rendering in `lib-svg`. None are copied into this repository.

UI-to-UI dependencies stay local. External dependencies use canonical `https://github.com/silk-lang/lib-NAME.git` URLs with exact 40-character revisions and package paths. Consumers must use these same revisions throughout their graph: Silk does not accept two physical checkouts of one named package.

## Building and checking

From this repository root, with the toolchain on `PATH`:

```sh
silk check --workspace
silk build --manifest-path ui/inspect/cli/silk.toml
node scripts/check.mjs
node scripts/check-native.mjs
node scripts/check-browser.mjs
```

`check.mjs` checks every workspace package, runs all ten UI unit-test roots and the loopback HTTP image test, executes all five describe/PNG golden runners, builds the text/inspector/MCP CLIs, checks portable APIs for wasm32, and checks asset/browser-export freshness. It does not update goldens. `check-native.mjs` runs all four native rendering/input scenarios, then socket inspector, MCP, and devtools interactions. Linux runs both X11 and Wayland (`--backend x11` or `--backend wayland` selects one). `check-browser.mjs` compares Chrome text fragments, renders all browser fixture trees against the CPU reference, and tests the counter through the window/browser host with real input.

Individual entrypoints remain available:

```sh
node ui/app/demo/scripts/demo
node ui/components/demo/scripts/demo check --release
node ui/tree/demo/scripts/demo --editor
node ui/tree/demo/scripts/demo inspect
node ui/tree/demo/scripts/demo mcp
node ui/tree/window/demo/run --check
node ui/inspect/devtools/scripts/devtools todo
node ui/inspect/devtools/scripts/devtools check
node ui/inspect/devtools/scripts/devtools --connect 1
node ui/tree/window/scripts/browser serve
node ui/tree/window/scripts/browser test ui/tree/window/demo -- --size 400,250 --click 90,35
```

The devtools check drives the owned todo demo: live element discovery, selection/highlighting, style declarations, box model, input/event logging, changed tree content, and screenshots of both windows. Notes-specific persistence and its devtools acceptance remain application-repository checks. To launch devtools alongside another already-built debug application, use `devtools external --app-binary PATH [--app-arg ARG ...]`; to connect to an existing process, use `--connect ADDRESS`.

## Runtime resources and published browser payloads

No sibling checkout is needed. `scripts/dependency-root.mjs` resolves external payloads from the exact revisions in UI manifests to `$SILK_HOME/git/<revision>` (default `~/.silk/git/<revision>`), rejecting missing or inconsistent pins. Run Silk first so the dependency checkout exists. It never imports another repository's private Python helper.

These paths are supported payloads for applications using the published Git revision:

- `ui/tree/window/browser/app-host.js`, `index.html`, `serve.mjs`, and `test.mjs`.
- `node <lib-ui>/ui/tree/window/browser/serve.mjs APP.wasm [PORT]` serves an externally compiled module.
- `node <lib-ui>/ui/tree/window/browser/test.mjs --wasm APP.wasm [--size W,H] [--scale N] [--click X,Y] [--type TEXT] [--stored KEY] [--screenshot FILE]` exercises its render check, real input, and optional localStorage/reload behavior. On Linux provide a display, for example with `xvfb-run -a`.
- The page imports `/ui/tree/window/browser/app-host.js`; its imports retain `/native/platform/window/browser/window-host.js` and `/native/gpu/webgpu/browser/host.ts`. The server maps those URL prefixes to the manifest-pinned native checkout, not a source-tree directory. Custom servers must provide the same mappings.
- Browser application roots must import their own WebGPU export module, using the template `native/gpu/webgpu/browser/generated_webgpu_exports.silk` from that same native revision and direct `webgpu`/`webgpu_sys` aliases. `node scripts/generate-browser-exports.mjs` refreshes the two owned roots; `--check` checks freshness. Wasm builds on POSIX use an 8 MiB stack through the Node clang wrapper; Windows retains the compiler's default stack.

UI fixture assets are owned under `ui/assets/assets` and embedded in `src/generated_assets.silk`. `node ui/assets/scripts/embed-assets [--check]` refreshes/checks them without Python. The historical procedural photo authoring script is optional, self-contained, and uses Pillow only when deliberately regenerating committed photos; it is not a build dependency. Additional text-comparison fonts are owned under `ui/text/tests/fonts`; all Noto, Amiri, M+ and Roboto Flex OFL notices accompany their unchanged subset files. Unit tests and golden runners use repository-root working directories. Fonts/icons/photos needed by normal UI fixtures are embedded and do not depend on the working directory.

See [the UI guide](ui/README.md), [the framework](ui/app/README.md), [components](ui/components/README.md), and [inspection tools](ui/inspect/README.md).
