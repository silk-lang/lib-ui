# Native application primitives

Use `runWindow` for a UI-only application, or `runWindowHosted` when it also draws a custom
GPU scene or handles native menus and dialogs. Both use the same window, input, clipboard,
IME, accessibility, inspection, layout, atlas-upload and presentation loop.

## Layout

`Ui.style` accepts the complete author-facing vocabulary of `modules/layout.Style`: Flex and
Grid, intrinsic and `calc` dimensions, margins/padding/insets, all five positioning modes,
writing modes and text orientation, floats, overflow, scrollbar policies, alignment and
alignment safety, text wrapping/spacing and fragmentation rules. Font keys, replaced-element
flags and the engine's Grid storage handles are managed by the UI layer.

```silk
let columns = ui.alloc(Grid.columns(2))
ui.grid(&columns, |ui| {
  ui.width(ui.alloc(calc(-24.0, 100.0)))
  ui.gap(12.0)
  ui.box(|ui| { ui.text("First") })
  ui.box(|ui| { ui.text("Second") })
})
```

`Grid.template` exposes tracks, min/max sizing, repeats, auto placement, named lines/areas
and subgrids. `Grid.name` and `Grid.areaName` validate and return local handles; the UI copies
and remaps names when applying the template. `ui.gridTemplate` also applies placement to a
child. Omitting it on the next render clears the old template. For page/column output, pass
host rectangles to `UiTree.frameFragmented`; ordinary `frame` returns to continuous flow.

`ui.onLayout` receives the node's allocated `Rect<f32>` after layout, once on attachment and
again when its bounds change. Use it to size a virtual list or custom drawing viewport.
Avoid sending model changes when the measured value is already current. `ui.viewport()`
and anchor rectangles support overlays; standard menus, popovers and tooltips flip and
constrain their content to the available window space.

## Images

Give an image its own dimensions, semantics and interaction handlers:

```silk
ui.imageWith("photos/cover.png", |ui| {
  ui.width(px(320.0))
  ui.height(px(180.0))
  ui.label("Project cover")
  ui.style(&[
    css.objectFit(ObjectFit.Cover),
    ui.alloc(css.objectPosition(percent(50.0), percent(25.0))),
  ])
  ui.onClick(|| Message.OpenCover)
  ui.onError(|| Message.CoverMissing)
})
```

`ObjectFit` supports Fill, Contain, Cover, None and ScaleDown. Position percentages refer to
the space left over after fitting, including negative space for a crop. Rounded clipping
uses the image's content box independently of its sampling rectangle. `ui.image(url)` remains
the unstyled convenience form; `ui.iconWith` gives icons the same styling body.

A picture is named by URL, and the window loads each URL once, by its scheme:

- a relative URL (`"photos/cover.png"`) is one of the app's own files: one the program carries,
  given with `window.file("photos/cover.png", Source.read("assets/photos/cover.png"))`, or else
  the file at that path from the working directory;
- `file:` reads a local file and `https:` or `http:` fetches, both on at most two native workers
  (`ui-tree-window.images`); requests have a 15-second deadline and a 16 MiB body limit;
- `data:` holds the bytes in the URL, base64 or percent-encoded.

Until it loads, the node shows nothing. `ui.onLoad` and `ui.onError` hear how it ended, as DOM
`load` and `error` do; a node that shows a URL after it loaded hears `load` too. The loader is
`ui-tree-window.loader.Loader`, which the app host serves after every update; another host
of a `UiTree` calls `loader.serve(tree)` the same way. `UiTree.imageTile` provides managed atlas
access for custom drawing.

Run the image-loading HTTP integration tests from the repository root with
`silk task native http-test` (`--compiler PATH` and `--clang PATH` select toolchain binaries).
The task owns the loopback photo fixture at `127.0.0.1:28183` and stops it after the tests.
Managed native tasks currently support macOS and GNU/Linux; Windows requires
[Silk's managed subprocess support](https://github.com/silk-lang/silk/issues/3034).

## Custom drawing and text

Implement `WindowContent` methods as needed; each has a default:

- `setup` installs resources; `configure` and `opened` customize the native window.
- `poll` collects background work before waiting; `wakeAfter` bounds that wait.
- `prepare` updates model-dependent geometry before layout. `frame` composes after layout
  and before atlas uploads. `scene` returns the composition used by inspection and checks.
- `draw` defaults to drawing that scene. Override it for retained buffers or extra passes;
  `gpu` initializes device-specific resources.
- `event`, `update` and `closing` handle native application operations. Returning false from
  `closing` keeps the window open when saving fails.

The host dispatches measured-layout events before custom composition. Its CPU/GPU check
mode can finish even when the window is occluded. Input and timers remain on the UI thread.

`ui_tree.canvas_text.TextCache` provides shared text measurement, glyph raster caching,
viewport cropping, atlas eviction and zoom-density reuse. A `TextRequest` carries an immutable
content key, font/style and document rectangle; a `TextViewport` carries the camera. The
measurement tree uses the application's font collection and family ids. Initialize it with
`canvas_text.setup`, then use `measurement` or `raster`. Set `deferDensity` during zoom and
request a settled frame to refine. Call `reset(destinationTree)` before reusing document keys.


## Background commands, fonts and controls

`Background<T>.start` runs an owned `Transferable` closure. `poll` is nonblocking; `wait` joins
explicitly. Inputs/results must own process-heap memory, not a view arena or borrowed model.
Dropping an unfinished job joins it. `Cancellation` is a cooperative flag.

For deferred app commands, call `runtime.deferCommands()` and use `Commands<A,M,C>` as window
content, or forward its `poll` and `wakeAfter` from custom content. It runs at most four
`Perform<M, never, never>` commands at once. Commands construct their own services and return
operational errors as messages. Ordinary `runWindow` still executes commands synchronously.

`font_collection.system.load` discovers platform and user font directories and configures
generic families. Its file/byte/depth budgets and report make eager loading explicit; add
bundled fallbacks first. `system.file` and `system.directory` also support packaged font sets
and injected filesystems. `runSystemWindow` performs discovery for a simple UI-only window.

`numberInput` preserves incomplete drafts and emits Edit, Commit, Invalid or Cancel. Enter
and blur commit; arrows step and Shift multiplies the step by ten. Commit handlers should
ignore unchanged values, so Enter followed by blur creates one undo entry. `colorPicker`
provides an RGBA swatch and channel sliders, and `withChannel` updates one packed channel.

## Accessibility and current limits

On macOS, `ui-tree-window.serve` publishes retained AppKit accessibility elements with roles,
labels, values, focus, enabled/selected/checked/expanded state and screen-space bounds. Press,
focus, text replacement and slider increment/decrement return through the same app event
path. Modal focus traps restrict the published tree and its actions. Both the stock host and hosted custom drawing use this bridge.

Windows/Linux OS accessibility bridges are not implemented; `window.accessibility.supported()`
reports this. This initial macOS bridge does not expose text-range navigation or selection
through the full accessibility text protocol. It does not turn arbitrary canvas document
shapes into accessible UI controls; applications must supply document semantics as UI nodes.

## Shared tree host

The native event/GPU loop now lives in `ui-tree-window.host`. This package retains
its app-facing `runWindow`, `runWindowHosted`, and `WindowContent` API as an adapter.
Direct tree clients can use the same host without creating an app runtime; see
[the direct-tree example](../../tree/window/demo/src/main.silk).

`runWindowHosted` (and so `runWindow`, `runWindowWith` and `program.show`) runs the host with
the in-process devtools as its companion (`ui_devtools.embedded.EmbeddedDevtools`, read from the
environment): in a debug build, `SILK_UI_DEVTOOLS=window`, `dock` or `1` opens them at start and
F12 toggles them, with no change to the app. They are inert in release builds and in check
mode. See [ui-inspect-devtools](../../inspect/devtools/README.md#in-the-apps-own-process).

The host registers silk-ui's inspector extension (`silk-ui`, [ui-app-inspect](../inspect)) with
the inspector it is given, and serves it on every turn of its loop while the inspector is on:
the program's journal goes to the extension's log, and the extension answers what waits for it
and renders its Program panel while a client has it open. `WindowContent.intercept` lets a
content take the records of nodes it put in the tree itself before the program sees them (the
devtools window replays an app's panel view that way).

Image loading and native workers are implemented in `ui-tree-window.images` and
`ui-tree-window.background`. Existing imports from this package remain compatible.
