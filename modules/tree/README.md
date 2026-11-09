# ui-tree

The retained UI tree, like a small DOM: you make nodes, put them in each other, style them, feed
input in and read events out, and ask for a frame to draw. It is laid out by
[css-layout](https://github.com/silk-lang/lib-css/tree/main/modules/layout) with [ui-text](../text), and painted into a
[ui_scene](https://github.com/silk-lang/lib-graphics/tree/main/modules/ui_scene) `Scene` that the CPU reference or
[ui_renderer](https://github.com/silk-lang/lib-graphics/tree/main/modules/ui_renderer) draws. It has no closures and no callbacks: what
crosses the boundary is plain data, so Silk code can call it directly and a JavaScript or remote
host can drive it through the mutation protocol.

## Using a tree

```silk
import ui_tree.lib { Tree, Viewport, Property, Length, Side, EventKind, Event, Input }

let mut tree = run Tree.make(&fonts)               // borrows a font_collection FontCollection
let sans = run tree.fontFamily("Inter, Noto Sans, sans-serif")
let root = run tree.box(&[
  Property.FontFamily { family: sans.raw() },
  Property.Padding { side: Side.Top, value: Length.px(16.0) },
])
let save = run tree.box(&[])
run tree.append(save, run tree.text("Save"))
run tree.append(root, save)
run tree.setRoot(root)
run tree.listen(save, &[EventKind.Click])

let frame = run tree.frame(Viewport { width: 800.0, height: 600.0, scale: 2.0 }, time)
// draw frame.scene after copying frame.uploads, then: tree.clearUploads()

run tree.dispatch(Input.press(20.0, 30.0))
run tree.dispatch(Input.release(20.0, 30.0))
let records = run tree.events()
// records[i].target, records[i].path, and records[i].event:
//   Event.Click { pointer, button, count } => ...
```

- **Nodes** come back as typed handles: `tree.box(style)`, `tree.span(style)` (an inline box),
  `tree.text(value)`, `tree.input(style)`, `tree.image(source, style)`, `tree.icon(source, style)`
  and `tree.canvas(style)` return `BoxNode`, `TextNode`, `InputNode`, `ImageNode`, `IconNode`
  and `CanvasNode`. The kind is in the type, so appending to a text node or setting the text of
  a box does not compile. Every handle has an `id()`, a `NodeId`, which is what events and
  queries name nodes by; `BoxNode.of(id)` and the others turn an id back into a handle.
- **Structure**: `setRoot`, `append`, `insertBefore`, `remove` (detach, can be appended again)
  and `destroy` (free the subtree). A child already in the tree moves, as in the DOM.
- **Style** is a list of typed `Property` values: `setStyle` for the base look, `setStyleFor`
  with a `StyleState` for hover, active, focus and focus-visible, and `clearStyle`. Text
  properties inherit; the rest do not.
- **Content and attributes**: `setText`, `setSource`, `setCanvas`, `setGrid`, `setAttribute`
  (role, label, test id, tab index, cursor, disabled, focus trap, checked, selected, expanded,
  and for inputs multiline, read-only and placeholder), with `setLabel`, `setTestId` and
  `setRole` for the common ones.
- **Events**: `listen(node, &[EventKind.Click, ...])` says what a node wants records for,
  `dispatch(input)` feeds a pointer, wheel, key or text `Input` in, and `events()` takes the
  queued `EventRecord`s. A record has the `target`, the `path` from the root to it, and an
  `Event` union whose variants carry only what that event has. `record.hits(node)` asks whether
  the event reaches a listener on `node` while bubbling. See [Interaction](#interaction).
- **Focus, selection and scrolling**: `focus`, `blur`, `focused()`, `select`, `selection`,
  `caretRect`, `scrollTo`, `scrollIntoView`, `scrollOffset`.
- **Resources**: `fontFamily(names)`, `defineImage(bytes)`, `defineDecodedImage(image)`,
  `defineIcon(bytes)` and `release(resource)`.
- **Frames**: `frame(viewport, time)` returns a `Frame` with the `scene`, the atlas `uploads`,
  the `cursor`, the `ime` area, `wakeAt` (the next caret blink) and `again` (the tree wants
  another frame right away). `needsFrame()` tells an on-demand host whether to ask.
- **Queries** answer with `Option` when there may be nothing: `root()`, `parent`, `children`,
  `kind`, `hitTest`, `bounds`, `fragments`, `find`, `view` (a `NodeView` snapshot for inspectors
  and tests) and `describe` (the text snapshot goldens compare).
- **Errors**: calls fail with a `TreeError` (`StaleNode`, `WrongKind`, `Cycle`,
  `UnknownResource`, `BadResource`, `BadVirtualList`, `Layout`, `View`), and
  `error.message()` says it in a sentence: `node #12 does not exist (it was destroyed, or never
  created)`. An id is not handed out again after its node is destroyed, so an old handle fails
  and never names a newer node.

## The mutation protocol

A JavaScript or remote host drives the same tree with plain data. It chooses its own node, font
family and resource numbers, sends `Mutation` values, and gets the same event records back.

```silk
let mut batch = Batch.make()
run batch.fontFamily(1, "Inter, Noto Sans, sans-serif")
run batch.create(1, NodeKind.Box)
run batch.style(1, &[Property.Padding { side: Side.Top, value: Length.px(16.0) }])
run batch.root(1)
run batch.text(1, 2, "Hello")                     // create, set text, append to 1
run tree.apply(run batch.take())
```

- `apply` stops at the first mutation that fails with a `ProtocolError` holding its `index` and
  the `TreeError`; the mutations before it stay applied.
- `Mutation` (`mutation.silk`) has one variant for each thing a direct call does: `Create`,
  `InsertBefore`, `Remove`, `Destroy`, `SetStyle`, `ClearStyle`, `SetText`, `SetAttribute`,
  `SetSelection`, `SetListeners`, `SetRoot`, `Focus`, `Blur`, `ScrollTo`, `ScrollIntoView`,
  `SetSource`, `SetCanvas`, `SetGrid`, the virtual list and anchor mutations, and the resource
  definitions.
- Direct calls and protocol ids can share one tree: `NodeId.of(7)` names the client's node 7,
  and a node made with `tree.box` takes a number that is not in use.

## Moving from the old API

`ui_tree.lib` is the API above. The engine underneath is `ui_tree.engine` (`UiTree`), and the
old front door is `ui_tree.legacy`, which the packages of this repository import until each is
ported. `tree.engine()` reaches the engine from a `Tree` for those packages. The sections below
still describe some features in the engine's terms (`Mutation` names, `takeEvents`, `LISTEN_*`
flags); each has the direct call listed above.

## Virtual scrolling

Variable-height virtualization belongs to the retained tree. `ui-app` uses the same
mutation/query protocol available to a direct Silk client or a future JS binding;
it does not maintain a separate geometry algorithm.

1. Create a box with a bounded height, vertical flex layout, and scrolling enabled.
   Configure it with `Mutation.SetVirtualList { id, count, options }`, or
   `Batch.virtualList`. `VirtualOptions` supplies an estimated row height, overscan,
   gap, and content revision.
2. Read `tree.virtualRange(id)`. Mount ordinary child boxes for `[first, end)` and
   the optional `pinned` index. The pin retains the row containing keyboard focus;
   `pinnedId` identifies its existing wrapper. Destroy other rows, retaining durable
   application state outside those nodes.
3. Send `Mutation.SetVirtualItems { id, items }` (or `Batch.virtualItems`) with
   `{ index, id }` records for **all** direct children in ascending logical order.
   The tree owns the layout-only spacers between these nodes. These private nodes
   never become client IDs, hit targets, or accessibility entries.
4. Call `tree.frame`, then query the range again. Reconcile and frame again if the
   requested range changed, before presenting. Repeat after scrolling, resizing,
   changing content, or changing focus. `layoutNow` also updates measurements and
   the range, but does not paint. `needsFrame` reports tree work; the host must
   still check range requests after a completed frame.

The tree measures mounted boxes, maintains a prefix-sum height index, and anchors
the visible item while estimates change. Height lookup and updates are logarithmic;
measurement storage is linear in logical item count. Width changes, count changes,
changed estimates/gaps, or a changed `revision` reset measurements. Revisions retain
the visible **index**, not the identity of an item moved in the model. A client that
reorders content should preserve the focused node and bind it at its new index.

The container must be a vertical, nonwrapping flex column with no unrelated children,
vertical padding, or external row gap. Row wrappers must be in normal flow, in logical
order, with no vertical margins and `flex-shrink: 0`; their contents can have natural,
variable heights. Use `options.gap` for spacing. Estimates must be finite and positive;
overscan and gaps must be finite and nonnegative. Zero-height rows are accounted for
with a minimum one-pixel extent. Invalid configurations or bindings return
`TreeError.BadVirtualList`; a rejected binding preserves the previous bindings.

`ClearVirtualList` removes the controller and its private spacers while preserving
ordinary child nodes. Destroying its container releases both. Virtual scrolling uses
continuous layout: clear the controller before `frameFragmented`, which otherwise
returns `TreeError.Layout`. Search, selection, tab navigation, and accessibility only
see mounted nodes; document-wide operations still need model-level support.

See [the direct-tree integration test](tests/src/virtual_lists.silk) for a complete
client using only mutation batches and range queries, including distant jumps,
focus retention, variable row heights, resize anchoring, and cleanup.

## Anchored popups

`Mutation.SetAnchor { id, target, options }` attaches a popup box to an anchor node.
`AnchorOptions` specifies the gap, preferred height, end alignment, and whether to
match the anchor width. The tree chooses above/below placement and viewport limits
after continuous viewport layout, then updates them on scroll and resize without a framework render.
The popup uses fixed viewport positioning; put it after ordinary content so it draws
and receives hits above that content. This API does not change parentage or event
bubbling. Menus and popovers in `ui-components` use it through `Ui.anchored`.
Width matching includes the popup's padding and border; menus no longer add those
on top of the trigger width.

`ClearAnchor` restores the popup's client styles. An anchor that is detached or not
laid out hides the popup until it has geometry again. Destroying the popup removes
its relationship. The anchor must exist at configuration time; cyclic anchor
relationships and anchors inside their own popup are rejected. Popup decoration,
open/closed state, dismissal, and menu keyboard behavior remain client concerns.

## Canvas text and image requests

`canvas_text.TextCache` owns raster tiles and measurements. `canvas_view.TextBindings`
tracks instance rectangles and validates visible coverage, raster generations, and
density. Its checks skip regions already covered during panning and validate shared
rasters once when all text has complete bindings. `canvas_view.Refinement` supplies
the idle deadline for improving text density after motion. These APIs do not depend
on an application document model.

Build bindings in scene order with `append`, using `usize.MAX` for a missing raster.
Use `rebind` after refreshing an instance and `clear` before rebuilding geometry.
Advance `TextCache.rasterFrame` for each raster/binding update epoch. Set
`allTextBound` only when every instance has an uncropped raster in that epoch.
A host can defer density changes during motion; missing or uncovered text must still
refresh immediately. Wake at the refinement deadline even when input stops.

`image_load.ImageLoad` is a portable request state machine. Capture the token returned
by `begin`, test `accepts(token)` before installing pixels, then call `finish`.
Replacement and cancellation invalidate old tokens. Native or browser hosts supply
file/network I/O and decoding; the tree continues to accept `DefineImage` and
`DefineDecodedImage` mutations. The native worker implementation is available through
`ui-tree-window.images`, with compatibility exports from `ui-app-window.images`.

## Interaction

Hosts feed plain-data `Input` records (`input.silk`) to `tree.dispatch`: pointer move, down, up,
leave and cancel, wheel, key down and key up, with positions in CSS pixels and keys named as UI
Events name them (`key` `"Enter"`, `code` `"KeyA"`). [ui-tree-window](window) turns
modules/platform/window events into them; tests and inspectors build them directly. The tree acts on
input against the last frame's layout, and the changes show at the next frame
(`tree.needsFrame()` says whether one is due).

- **Hit testing** walks the fragments topmost first (later siblings and children paint on top),
  applies overflow clipping per axis against the padding box, and skips nodes with
  `pointer-events: none` (not inherited by native `Style`) or `visibility: hidden`. Text is never
  a target: its element is, as in the DOM. `tree.hitTest(x, y)` and CSSOM View use the same walk.
- **Hover and active.** The hit node and its ancestors are hovered; pressing the primary button
  makes the pressed node and its ancestors active. Their `Hover` and `Active` looks apply, and
  enter and leave records go to listeners (leave deepest first, enter outermost first). Hover
  follows content that moves under a still pointer after scrolling or relayout.
  `tree.cursor()` is the hovered path's cursor (inputs default to the text cursor).
- **Pointer capture.** The node a primary press lands on gets the moves and the release until
  the button comes up, so drags keep their target. The click goes to the nearest common
  ancestor of the press and release targets, with the click count. Disabled nodes (and their
  subtrees) get no down, up or click and no active state.
- **Focus.** A press focuses the nearest focusable node at or above it, or blurs. Focusable
  means a tab index other than `NOT_FOCUSABLE` (the default for everything but inputs), laid
  out, visible and not disabled. Tab and Shift+Tab move through the tabbable nodes (tab index
  0 or more): positive indices first, lowest first, then tree order, wrapping; inside a node
  with the `FocusTrap` attribute they cycle within it. Focus that came from the keyboard shows
  the `FocusVisible` look (inputs always do), and Tab scrolls the new focus into view.
- **Keys** go to the focused node, or the root, with the key, code, modifiers and repeat.
  Enter on a focused button, link, menu item, tab or option and Space (on key up) on a button,
  checkbox, radio, switch, menu item, tab or option queue a click with click count 0.
- **Scrolling.** Boxes with `overflow: auto` or `scroll` on an axis scroll with the wheel. Each
  axis of a wheel delta goes to the nearest container that can still move that way, and the
  rest goes outwards, so nested scroll boxes work. `hidden` allows programmatic scrolling:
  `ScrollTo` (clamped at the next frame), `ScrollIntoView`, and the `cssom_view` scroll APIs.
  Nearest alignment leaves an oversized target alone when it already covers the scrollport.
  Fractional scroll offsets move scene groups, hit targets, and geometry queries together
  without requiring relayout. `tree.scrollOffset(id)`, `info`, and `describe` report them,
  and listeners get `Scroll` records with the new offset. Scroll containers with something
  to scroll draw overlay thumbs that take no space and can be dragged.
- **Records** for pointer down, up, move, click, wheel and keys are queued when the target or any
  node on its path listens (they bubble, client side). Enter, leave, focus, blur and scroll are
  queued only for a target that listens itself.

## CSSOM View

`ui_tree.cssom_view` adapts the shared `modules/style` View algorithms to this tree:

- `elementFromPoint` and `elementsFromPoint` use the input hit traversal, including actual
  clipping, sticky offsets, and pointer-event eligibility. Viewport/root fallback is applied
  by the View API rather than changing input dispatch.
- `getClientRects` and `getBoundingClientRect` report rendered border-box fragments in CSS
  pixels; anonymous input/text internals are not extra element boxes.
- `NativeGeometry` supplies box quads and coordinate conversion from actual layout.
- Client, scroll, and offset metrics use the layout and scroll ranges already used by input.
- Caret and range geometry use shaped glyph positions; returned DOM text offsets are UTF-16,
  not the UTF-8 byte offsets used by the editing implementation.
- `scroll`, `scrollTo`, `scrollBy`, and `scrollIntoView` support immediate and smooth requests.
  The tree owns pending requests and completion/interruption state. Feed monotonically
  increasing `FrameInput.time` and keep drawing while `needsFrame()` is true; smooth movement
  uses a 250 ms ease-out. Wheel, pointer-down, and key-down input interrupt pending motion.

Call geometry APIs after current layout has been produced. This adapter does not add a CSS
parser-to-`Style` bridge, browser browsing contexts, general element transforms, or
`content-visibility` to the renderer. Unsupported host features are not represented by
fabricated geometry.

## Text editing

Input nodes edit their value themselves and tell the client with `Input` records (DOM-named
`inputType`, the new value and selection). Everything they draw comes from css-layout's text
fragments: the caret, the selection rectangles and the composition underline are placed from
each fragment's `sourceStart`/`sourceEnd` and the advances of the glyph run ui-text shaped
during layout (interpolated inside ligatures), and a click goes to the nearest grapheme
boundary on the nearest line by the same positions. Nothing is shaped outside layout.

- **Display text.** What css-layout lays out is the value with the input method's composition
  spliced in at the caret, or the placeholder when the value is empty, plus a zero width space
  where a line would have no text (an empty value, or a trailing line break in a multiline
  input) so the caret has a line box. Inputs default to `white-space: pre` and
  `overflow: hidden` on one line, `pre-wrap` and `overflow-y: auto` with `Multiline`.
- **Input.** `Input.TextInput` types or commits, `Input.ImePreedit` shows a composition (its
  selected clause underlined thicker; empty text cancels), `Input.Paste` answers a clipboard
  read. [ui-tree-window](window) maps modules/platform/window's `TextInput` and `ImePreedit` to them.
- **Keys** (Control on Windows and Linux, Command and Option with `Keymap.Mac`, the default on
  macOS builds): arrows by grapheme, word or line end, Shift to extend; Home and End (visual
  line in multiline inputs, before the space a soft wrap hangs); Up and Down by visual line
  keeping the x; Backspace and Delete by grapheme, word or line; Enter in multiline inputs;
  select all, copy, cut, paste, undo and redo. Typing replaces the selection; single-line
  inputs turn typed or pasted line breaks into spaces. Keys pass to the input method while it
  composes.
- **Pointer.** A press places the caret (Shift extends), a double click selects a word, a
  triple click the line or the whole single-line value; dragging extends by the same unit. A
  press commits a composition. Tab into an input selects its text.
- **Undo.** Consecutive typing, and consecutive deletions, merge into one step, up to 100
  steps. A `SetText` with a different value puts the caret at the end and forgets the history;
  the same value changes nothing, so a client can echo every record back (controlled inputs).
  `ReadOnly` inputs select and copy only.
- **Host requests.** The tree owns no clipboard: copy and cut queue
  `HostRequest.WriteClipboard`, paste `HostRequest.ReadClipboard { target }`, drained with
  `takeRequests`. `imeArea()` gives the caret (the composition's start while composing) for
  the candidate window. `ui-tree-window`'s `serve` answers both through a `Platform`.
- **Caret.** It blinks with frame time (0.5 s on, 0.5 s off, on again after each edit or move),
  repainting only its input; `nextBlink()` says when to draw next. After layout, the focused
  input scrolls so the caret is in view (a single-line input scrolls back to its start on
  blur). `CaretColor`, `SelectionColor` and `PlaceholderColor` style it. `caretRect(id)` and
  `selection(id)` report it, and `describe` writes `selection=`, `preedit=` and the input flags.

## Frames

`frame` resolves styles, lays out, and paints:

- **Layout** is incremental. Style changes reach css-layout only when they change a layout
  input, and an unchanged tree at an unchanged size skips `compute`.
- **Paint** walks the layout fragments, not the nodes. Boxes paint their background (solid or
  linear gradient), border (solid or dashed, per side, with radii), outer and inset shadow,
  opacity (an isolated layer) and `overflow: hidden` clip. Text is drawn from css-layout's text
  fragments: each fragment's `shapeKey` names the glyph run ui-text shaped during layout, so
  nothing is shaped twice. Inline boxes paint their decorations per fragment, so a highlighted
  span split across lines gets one background per line with the outer edges only on its first
  and last pieces. Underline, overline and line-through follow the text color or a decoration
  color, wavy or straight. Glyphs, icons and images go through the shared atlas as sprites.
- **Replay.** Each fragment gets a hash of everything that affects its subtree's paint. When a
  subtree's hash, clip and scale match the previous frame, its operations are copied with
  `Scene.replay` instead of being painted again. `tree.stats` (`FrameStats`) counts replayed and
  repainted subtrees, painted fragments, glyphs, primitives and layout work.

## Inspection

For people and agents looking at a running UI (`inspect.silk`):

- `info(tree, id)` gives a node's kind, parent, bounds, focus and hover state and paint order;
  `fragmentsOf` its layout fragments with border, padding and content rects; `childrenOf`, and
  `findAll(tree, value)` finds nodes by test id, label or text.
- `describe(tree, options, &mut out)` writes a deterministic text snapshot, one line per node
  with role, label, test id, text, focus, disabled, checked, selected, expanded, rects and
  scroll offsets, and with `DescribeOptions.withStyles()` the styles
  that differ from the defaults or the parent. `describeNodeById` does one subtree.
- `CpuSnapshot` renders the whole frame, or one node's subtree cropped to its box
  (`renderNode`), with the CPU reference; `encodePng` turns either into PNG bytes.
  `renderScene` draws another scene over the tree's atlas, such as an inspector overlay.
- [ui-inspect](../inspect) builds on these: queries by role, name and text, hit paths and an
  element picker, the devtools highlight overlay, a node view, synthetic input, and session
  record and replay.

## Tests

```sh
silk test --manifest-path modules/tree/tests/silk.toml --root src/tests.silk
silk build --manifest-path modules/tree/tests/silk.toml
build/llvm/x86_64-unknown-linux-gnu/debug/ui-tree-tests modules/tree/tests/goldens [--update]
node modules/tree/scripts/test-browser
silk test --manifest-path modules/tree/window/tests/silk.toml --root src/tests.silk
node modules/tree/demo/scripts/demo [check]
```

- The unit tests cover replay (an unchanged frame replays the whole tree; changing one card's
  background repaints that card and its ancestors and replays the rest, with pixels equal to a
  fresh tree), relayout after text changes, failing mutations and id reuse, inheritance and
  state variants, focus events with paths, and the inspection queries.
- The interaction tests (`tests/src/interaction.silk`) script the inbox fixture with synthetic
  input and check the records (kinds, targets, paths, payloads), the states and looks, and
  what repaints: hover, press, capture and click, disabled nodes, pointer-events, Tab order
  with positive indices and focus traps, keyboard clicks, Tab scrolling the focus into view,
  wheel scrolling with nested chaining and clamping, hover following scrolled content,
  `ScrollTo` and `ScrollIntoView`, thumb dragging, and scrolled pixels equal to a fresh tree
  scrolled by mutations. `window/tests` sends modules/platform/window events through the headless
  backend and the adapter into the same fixture.
- The editing tests (`tests/src/editing.silk`) script the editor fixture: typing and undo
  grouping, grapheme and word movement (combining marks, a ZWJ emoji), both keymaps, the
  clipboard requests, clicks, drags and double and triple clicks placed from the fragments,
  multiline vertical movement and wrapped line ends, composition (drawn, committed, cancelled,
  replacing the selection, ended by blur), controlled values, `SetSelection` clamping, blinking
  and caret scrolling, and edited pixels equal to a fresh tree with the same value and
  selection. `window/tests` types, composes, copies and pastes through the adapter.
- The goldens are the trees in `fixtures/` (a card list with icons, an inline highlight
  across lines, an image, an opacity layer, a canvas chart and a clipped box; a sign-in form
  with a focus ring, a gradient button, a checkbox, an underlined link and a dashed note; an
  inbox with a toolbar, a scrolling list and a nested scroll box with their thumbs; an editor
  with a selection, a wrapping multiline input, a placeholder and a read-only input), each
  as a PNG (tolerance 2 per channel) and a `describe` text that must match exactly.
- `scripts/test-browser` builds `browser/` for wasm32 and draws the trees with ui_renderer on
  `navigator.gpu` in the installed Chromium, RGBA8 and BGRA8, against the CPU reference of the
  same frame, with examples/graphics-demo's limits (max 96, at most 0.2% of channels over 8, mean 0.25).
  The inbox receives a fractional `60.25px` wheel scroll before rendering, exercising retained
  scroll placement through the input/hit-testing path.
  On SwiftShader both trees stay under a mean of 0.07; the largest difference (75) is on the
  edge of the form's link underline.

Fixtures use examples/graphics-demo's embedded Noto Sans subsets, icons and photo, so the native tests and
the wasm build draw the same bytes.

## Limits

- Paint follows tree order: no `z-index` stacking contexts yet.
- One box shadow per box, and the `overflow: hidden` clip is the padding box rectangle, not
  rounded.
- Styles are resolved for the whole tree whenever any style changes (cheap next to layout, but
  not incremental).
- Batches are not atomic.
- The atlas never evicts.
- Scrollbars are overlays that take no space; the arrow keys, Page Up and Page Down do not
  scroll yet, and the root does not scroll the viewport (give it `overflow: auto`).
- Hit testing uses rectangles: rounded corners and clip radii are not hit shapes.
- No style transitions yet.
- Editing moves logically: in right-to-left text the arrows follow the text order, not the
  screen, and a caret at a direction boundary is drawn on one side only. No password masking,
  no drag and drop of text, no maximum length, and text outside inputs is not selectable.
- A press during a composition commits it in the tree; platforms whose input method keeps
  composing would need to be told (modules/platform/window has no call for that yet).
- The end padding of a single-line input is not part of its scroll range, so a caret at the
  end of a long value sits at the padding edge.
- Tab is always the tree's: a client cannot cancel it (use `FocusTrap` for dialogs).

## Window demo

`demo/` (`scripts/demo --editor` for the editor fixture, the place to try an input method)
is the inbox in a native window (modules/platform/window, ui_renderer on Dawn) and a tiny client:
it reads the records and answers with mutations (New appends a row and scrolls it into view,
Archive removes the focused row). `scripts/demo check` scripts a hover, a fractional wheel
scroll, and a Tab, then reads the surface back and compares it with the CPU reference,
on X11 and Wayland under Xvfb and Weston with lavapipe.

