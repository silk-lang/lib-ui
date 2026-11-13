# JavaScript app benchmark

The same React app on ui-js, Electron and Tauri, with three baselines: ui-js without a
window, the native tree counter (no JavaScript) and an empty Node script. It measures what
someone choosing a desktop stack compares: how big the app is, how much memory it takes,
how long until its first frame, and how quickly it answers input.

The app is [app/Counter.jsx](app/Counter.jsx): a counter button, a controlled text field,
and a button that renders 1,000 rows in one commit. Every target runs that one component.
Only `platform` differs: `box` and `input` on the tree, `div` and `input` in a browser.

## Running it

Linux with X11 libraries, Xvfb and a Vulkan driver (Mesa's lavapipe is enough):

```sh
apt-get install xvfb xdotool mesa-vulkan-drivers libx11-dev libxkbcommon-dev libwayland-dev wayland-protocols
(cd modules/js && npm ci)
silk task native js-bench -- --runs 5 --json bench.json
```

The task builds the Silk targets (release, plus debug for the size column) and the two
bundles, then runs [run.mjs](run.mjs). The browser targets are measured when they are
set up, and skipped otherwise:

```sh
# Electron
(cd modules/js/bench/electron && npm install && node node_modules/electron/install.js)
# Tauri (WebKitGTK 4.1 development packages and a Rust toolchain)
apt-get install libwebkit2gtk-4.1-dev libgtk-3-dev librsvg2-dev
(cd modules/js/bench && npm run bench:build && cd tauri && cargo build --release)
```

`node run.mjs --only ui-js,electron --runs 3` measures some targets again without the
builds. It is slow (about a minute per target) and depends on the machine, so it is not on
CI.

## What each number is

- **shipped**: the files the app needs next to the system libraries: the binary and the
  bundle for ui-js, Electron's `dist` folder and the app for Electron, the binary (with the
  web files inside) for Tauri. **gzip** is those files compressed, roughly a download.
  **system libs** is what Tauri needs installed on top (WebKitGTK and JavaScriptCore).
- **first frame**: from `spawn` to the app's `bench: first frame` line, which it prints two
  animation frames after its first render, so the frame holding it has been drawn. The
  cold run comes first, after the page cache is dropped (all of it when the script runs as
  root, so the system libraries and the GPU driver come from disk too, otherwise only the
  app's files); warm is the median of the other runs. Mesa's shader cache stays on disk, so
  cold is a second launch after a reboot, not the very first one. For the tree windows, **presented** is when the window host
  says frame 1 is on screen (`SILK_UI_TRACE_FRAMES=1`), which needs no JavaScript.
- **click to frame**: an XTest click ([xinput.py](xinput.py)) to the `bench: click N` line,
  again two animation frames after the commit; median of 10. **click to presented** is the
  first presented frame after the click, from the window host's trace. For the headless
  target the click and the frame are timed inside the process.
- **1000 rows to frame**: the same, for the button that adds 1,000 rows.
- **memory**: summed over the app's process and all its descendants (Electron has a GPU,
  renderer, utility and zygote processes, Tauri a WebKit web and network process). RSS
  counts shared libraries in every process that maps them, so **PSS** (each shared page
  divided among its users) is the fairer total. Idle is 1.5 s after the first frame,
  then again after the clicks and after the rows. **peak RSS** is the sum of each process's
  high-water mark.
- **idle CPU**: CPU time of all the app's processes over 5 s with nothing happening, as a
  share of one core.

## Results

Lib-ui main plus this change, Silk 0.1.0-dev.72, in a cloud container (no GPU, Xvfb,
lavapipe), Electron 45.3, Tauri 2 on WebKitGTK 2.52, Node 22. Run with
`node run.mjs --runs 5`.

Measured 2026-11-13T14:26Z on Intel(R) Xeon(R) Processor @ 2.30GHz (4 cores), 5 warm runs + 1 cold (the whole page cache dropped), medians.

Size (MB)

|  | shipped | gzip | binary | stripped | debug binary | JS bundle (gzip) | system libs |
|---|---|---|---|---|---|---|---|
| ui-js (SilkJS + React) | 44.5 | 17.0 | 44.2 | 40.7 | 110.2 | 0.2 (0.1) |  |
| Electron + React DOM | 287.1 | 125.6 |  |  |  | 0.2 (0.1) |  |
| Tauri + React DOM | 3.6 | 1.5 | 3.6 | 3.6 |  |  | 127.0 |
| ui-js without a window | 28.9 | 11.6 | 28.7 | 28.2 |  |  |  |
| Native tree counter (no JS) | 29.7 | 11.0 | 29.7 | 26.4 | 66.9 |  |  |
| Node, empty script | 124.9 | 45.1 | 124.9 | 107.2 |  |  |  |

Startup and input (ms)

|  | cold first frame | warm first frame | warm first frame presented | click to frame | click to presented | 1000 rows to frame |
|---|---|---|---|---|---|---|
| ui-js (SilkJS + React) | 389 | 245 | 245 | 33 | 17 | 75 |
| Electron + React DOM | 320 | 168 |  | 16 |  | 20 |
| Tauri + React DOM | 991 | 808 |  | 27 |  | 65 |
| ui-js without a window | 69 | 31 |  | 1.1 |  | 73 |
| Native tree counter (no JS) | 346 | 222 | 222 |  |  |  |
| Node, empty script | 33 | 28 |  |  |  |  |

Where a tree window's warm startup goes (ms since launch)

|  | window host started | window open | GPU device ready | frame 1 submitted | frame 1 presented |
|---|---|---|---|---|---|
| ui-js (SilkJS + React) | 12 | 29 | 230 | 232 | 245 |
| Native tree counter (no JS) | 14 | 15 | 208 | 209 | 222 |

1000 rows without a window (ms, in process): JavaScript and React commit 59, applying the mutations to the tree 0.0, style, layout and text 14.

Memory (MB, all processes of the app) and idle CPU

|  | processes | idle RSS | idle PSS | after clicks PSS | after 1000 rows PSS | peak RSS | idle CPU % |
|---|---|---|---|---|---|---|---|
| ui-js (SilkJS + React) | 1 | 176.1 | 154.3 | 154.2 | 184.2 | 206.0 | 0.0 |
| Electron + React DOM | 6 | 553.3 | 259.8 | 264.9 | 276.8 | 575.7 | 0.0 |
| Tauri + React DOM | 3 | 451.8 | 299.0 | 301.9 | 328.4 | 481.3 | 0.2 |
| ui-js without a window | 1 | 32.3 | 30.7 | 31.1 | 62.8 | 64.4 | 0.0 |
| Native tree counter (no JS) | 1 | 156.0 | 134.3 |  |  | 156.0 | 0.0 |
| Node, empty script | 1 | 44.7 | 24.9 |  |  | 44.7 | 0.0 |

### What it says

- **Size.** ui-js ships one 44 MB binary (17 MB compressed) against Electron's 287 MB
  (126 MB). Tauri's own binary is 3.6 MB, but it needs WebKitGTK installed (127 MB of
  libraries, which most Linux desktops have and macOS and Windows provide as WebKit and
  WebView2). Subtracting the targets gives a rough split of the 44 MB: about 14.5 MB is the
  SilkJS engine (ui-js against the native tree window), about 15.5 MB the window and GPU
  stack (ui-js against ui-js without a window), and the rest the tree, text, fonts and
  inspector. Building for size (`"optimization":"size"`) takes the binary from 44.2 to
  41.0 MB (37.2 MB stripped).
- **Memory.** ui-js idles at 154 MB PSS against Electron's 260 MB and Tauri's 299 MB, in one
  process against six and three. Almost all of ours is the window, not JavaScript: the
  native tree counter with no JavaScript takes 134 MB, and ui-js without a window 31 MB.
  In the ui-js window, Mesa's libLLVM (lavapipe compiles shaders with it) is 52 MB, the
  Vulkan drivers the loader opens and does not use (nouveau, radeon, intel, asahi and
  others) about 12 MB, and our binary's code 30 MB of clean, shared pages. The JavaScript
  side (engine, React, the app) costs about 20 MB.
- **Startup.** A warm first frame takes 245 ms, against Electron's 168 ms and Tauri's
  808 ms. Of the 245 ms, 200 ms is creating the GPU device (lavapipe), which happens after
  the window opens and before anything is drawn; the JavaScript adds about 15 ms (window
  open at 29 ms against 15 ms for the native counter), and ui-js without a window has its
  first frame in 31 ms. On a real GPU the device takes far less, so this column says more
  about lavapipe than about us.
- **Input.** A click reaches the screen in 17 ms (presented), one 60 Hz frame. Measured the
  same way as the browsers (two animation frames) it is 33 ms against Electron's 16 ms:
  our animation frames come once per drawn frame, so the second one waits a full frame.
- **1,000 rows** take 75 ms against Electron's 20 ms and Tauri's 65 ms. Without a window it
  is 73 ms, of which 59 ms is JavaScript (React's commit on the QuickJS-based interpreter,
  and the bridge calls) and 14 ms style, layout and text. The rows also cost about 30 KB
  each (184 MB after, from 154 MB), against 17 KB in Electron.
- **Idle CPU** is zero for everything but Tauri (0.2 % of a core).

### What could shrink

- **Intl and Temporal.** The realm does not install them, but their data is linked: the
  time zone, collation, locale and date tables (`intl_*_data`, `temporal_timezone_data`,
  about 12 MB of Silk source in lib-silkjs's engine) are in the binary. Per-build feature
  selection in the engine should drop them by default.
- **The rest of the engine** (14.5 MB with the tables above): the parts an app does not
  use, once the engine's features are packages a build picks.
- **Devtools.** The demo host links the inspector server (`startInspector`); a production
  build should not.
- **Optimizing for size**: 3.2 MB here, with no measured cost yet.
- **Startup**: create the GPU device while the JavaScript runs (only the surface needs the
  window), instead of after; skip `gsettings` (lib-native runs it through `popen` at
  window start for the dark mode setting, about 5 ms).
- **JavaScript speed and memory per node** are the gap on the 1,000 rows: the interpreter
  and bridge for speed, 30 KB per row for memory.

## Caveats

- The container has no GPU. The tree windows draw with lavapipe (Mesa's Vulkan on the CPU,
  which compiles shaders with LLVM), Electron with SwiftShader and software compositing,
  and WebKitGTK with its own software path. A GPU driver changes the windowed numbers,
  ours most: lavapipe is a large part of both the startup and the memory of a tree window
  (compare the native tree counter, which has no JavaScript). The headless row is the part
  that does not depend on the GPU.
- The ui-js host and the native tree window open at 400x250, the browser apps at 400x300.
- "Two animation frames" is when a frame has been produced, not presented; the presented
  columns are the more exact ones where they exist.
