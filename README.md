# Silk UI

Standalone retained UI, application framework, components, native/browser hosts, and inspection tools for Silk.

## Provenance and toolchains

Extracted without removing UI packages, fixtures, goldens, demos, inspector tools, or browser surfaces from `silk-lang/nonstd` commit `7d6c3693a9ad1fec24127985626ab4224f9f1995`. Packages live under `modules/`; public package names and import namespaces are unchanged. Applications such as Notes, Studio, Scroll Lab, Showcase, and Graphics Demo remain in their application repository; they are consumers, not dependencies of this repository.

Use Silk **0.1.0-dev.63+657e3c900f65**, LLVM **22.1.8**, and Node **22+**. `toolchains.lock.json` pins downloadable toolchains and their checksums. Silk performs compilation, package resolution, native archive preparation, and package generation directly. Node orchestrates processes, HTTP/browser fixtures, and inspection protocols; Windows native preparation uses PowerShell from the pinned `lib-native` payload. No normal build, test, or run command invokes Python.

For hosted CI, `node scripts/install-silk.mjs` installs the pinned compiler and adds its bin directory to `GITHUB_PATH` (locally it prints the directory to add to `PATH`). Then `node scripts/setup-ci.mjs` resolves the native dependency and provisions its pinned tools. `--linux-gpu` provisions lavapipe; `--browser` selects an existing Chromium and installs pinned Playwright JavaScript without downloading a browser. Local browser runners use `PLAYWRIGHT_MODULE`, `PLAYWRIGHT_CHROMIUM_EXECUTABLE`, and `CHROME_PATH` when supplied. Set `SILK` to override the Silk executable and `SILK_CLANG` for LLVM 22 clang.

WebAssembly builds require `SILK_CLANG` (set by `setup-ci.mjs`). The generated stack wrapper binds that executable directly because Silk deliberately filters compiler subprocess environments; it does not fall back to a different `clang` on `PATH`.

Linux native compilation needs X11, xkbcommon, Wayland, and wayland-protocols development headers; window checks additionally need Xvfb, xauth, Weston, and Vulkan/lavapipe. Windows requires the x64 Visual Studio 2026 developer environment, Windows SDK and PowerShell 7. macOS requires Apple Silicon macOS 26+ and `SDKROOT` set to `xcrun --sdk macosx --show-sdk-path`. The checked-in CI exercises native package checks and rendering/inspection on Linux, macOS, and Windows, plus browser checks on Linux.

Silk **0.1.0-dev.63+657e3c900f65** fixes Windows Git command paths and the launcher's
`SILK_HOME` representation ([silk#3025](https://github.com/silk-lang/silk/issues/3025)).
Repository runners use `silk` on every platform (override with `SILK`), including cold Git
dependency resolution on Windows. No direct compiler bypass or relaxed Git NTFS protection
is required.

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
silk check --workspace
silk build --manifest-path modules/inspect/cli/silk.toml
node scripts/check.mjs
node scripts/check-native.mjs
node scripts/check-browser.mjs
```

`check.mjs` checks every workspace package, runs all ten UI unit-test roots and the loopback HTTP image test, executes all five describe/PNG golden runners, builds the text/inspector/MCP CLIs, checks portable APIs for wasm32, and checks asset/browser-export freshness. It does not update goldens. `check-native.mjs` runs all four native rendering/input scenarios, then socket inspector, MCP, and devtools interactions. Linux runs both X11 and Wayland (`--backend x11` or `--backend wayland` selects one). `check-browser.mjs` compares Chrome text fragments, renders all browser fixture trees against the CPU reference, and tests the counter through the window/browser host with real input.

Individual entrypoints remain available:

```sh
node modules/app/demo/scripts/demo
node modules/components/demo/scripts/demo check --release
node modules/tree/demo/scripts/demo --editor
node modules/tree/demo/scripts/demo inspect
node modules/tree/demo/scripts/demo mcp
node modules/tree/window/demo/run --check
node modules/inspect/devtools/scripts/devtools todo
node modules/inspect/devtools/scripts/devtools check
node modules/inspect/devtools/scripts/devtools --connect 1
node modules/tree/window/scripts/browser serve
node modules/tree/window/scripts/browser test modules/tree/window/demo -- --size 400,250 --click 90,35
```

The devtools check drives the owned todo demo: live element discovery, selection/highlighting, style declarations, box model, input/event logging, changed tree content, and screenshots of both windows. Notes-specific persistence and its devtools acceptance remain application-repository checks. To launch devtools alongside another already-built debug application, use `devtools external --app-binary PATH [--app-arg ARG ...]`; to connect to an existing process, use `--connect ADDRESS`.

## Runtime resources and published browser payloads

No sibling checkout is needed. `scripts/dependency-root.mjs` resolves external payloads from the exact revisions in UI manifests to `$SILK_HOME/git/<revision>` (default `~/.silk/git/<revision>`), rejecting missing or inconsistent pins. Run Silk first so the dependency checkout exists. It never imports another repository's private Python helper.

These paths are supported payloads for applications using the published Git revision:

- `modules/tree/window/browser/app-host.js`, `index.html`, `serve.mjs`, and `test.mjs`.
- `node <lib-ui>/modules/tree/window/browser/serve.mjs APP.wasm [PORT]` serves an externally compiled module.
- `node <lib-ui>/modules/tree/window/browser/test.mjs --wasm APP.wasm [--size W,H] [--scale N] [--click X,Y] [--type TEXT] [--stored KEY] [--screenshot FILE]` exercises its render check, real input, and optional localStorage/reload behavior. On Linux provide a display, for example with `xvfb-run -a`.
- The page imports `/ui/tree/window/browser/app-host.js`; its imports retain `/native/platform/window/browser/window-host.js` and `/native/gpu/webgpu/browser/host.ts`. The server maps `/ui/tree/window/browser/` to this repository's `modules/tree/window/browser/`, and the two `/native/` prefixes to `modules/platform/window/browser/` and `modules/gpu/webgpu/browser/` in the manifest-pinned native checkout. Custom servers must provide the same distinct URL namespaces; `/modules/` is not a browser URL prefix.
- Browser application roots must import their own WebGPU export module, using the template `modules/gpu/webgpu/browser/generated_webgpu_exports.silk` from that same native revision and direct `webgpu`/`webgpu_sys` aliases. `node scripts/generate-browser-exports.mjs` refreshes the two owned roots; `--check` checks freshness. Wasm builds on POSIX use an 8 MiB stack through the Node clang wrapper; Windows retains the compiler's default stack.

UI fixture assets are owned under `modules/assets/assets` and embedded in `src/generated_assets.silk`. `node modules/assets/scripts/embed-assets [--check]` refreshes/checks them without Python. The historical procedural photo authoring script is optional, self-contained, and uses Pillow only when deliberately regenerating committed photos; it is not a build dependency. Additional text-comparison fonts are owned under `modules/text/tests/fonts`; all Noto, Amiri, M+ and Roboto Flex OFL notices accompany their unchanged subset files. Unit tests and golden runners use repository-root working directories. Fonts/icons/photos needed by normal UI fixtures are embedded and do not depend on the working directory.

See [the UI guide](modules/README.md), [the framework](modules/app/README.md), [components](modules/components/README.md), and [inspection tools](modules/inspect/README.md).
