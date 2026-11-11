# ui-inspect-devtools

A devtools window for a running Silk UI, in three columns under a top bar: the app's element
tree on the left; in the middle a tab for each panel the app's extensions add (a silk-ui
program's Program panel among them), the event log, the frame timeline with the frame stats and
an accessibility audit; on the right the inspector of the selected node: its Design (fields for
the common properties, edited in place), its Declarations (editable, with the box model) and the
Edits (style edits and comments, for an agent to carry into the code). Pointing at an element
washes it in the app's window, selecting it rings it, and Pick selects whatever is clicked in
the app's window.

The look is instrument black and amber, Geist for the interface and Geist Mono for code and
data (design: the Paper file "Silk UI Devtools"). Its palette, type and the small helpers every
panel draws with (rows, tabs, badges, segmented controls, fields, section labels, cards,
buttons, icons) are in `theme.silk`; the Design fields' reading and writing in `design.silk`.

It is built with the Silk framework itself ([ui-app](../../app)) and talks to the app only
through the inspector protocol ([ui-inspect-server](../server)), the same requests
ui-inspect-cli and ui-inspect-mcp send. So anything it shows, a script or an agent can read
too, and the devtools window is itself an app the inspector can drive. It keeps one protocol 3
session open with the app, subscribes to its topics, and reads again only what the app says
changed. It knows no framework: the tabs past its own come from `hello`.

Packages:

- `modules/inspect/devtools` (`ui-inspect-devtools`): the app (`devtools.silk`), what it reads out of
  the protocol's replies (`data.silk`) and the `Link` service it talks through (`link.silk`):
  requests numbered by `Requests` over the client end of a `Channel`, notifications, requests
  answered later (`Link.ask`, for extensions), and what the app pushed. `remote.silk` replays an
  extension panel's view (`ViewHost`). `embedded.silk` runs the same app in the inspected app's
  own process.
- `modules/inspect/devtools/app` (`ui-devtools`): the window, with a `Link` over a
  `SocketChannel` session. The pump thread rings a bell that wakes the window, which sends the
  devtools `Message.Pull`. View batches go from the session to the window's content, which
  replays them and takes their nodes' records (`WindowContent.intercept`) before the devtools'
  program does.
- `modules/inspect/devtools/tests`: the devtools inspecting the todo example in the same process,
  and golden scenes.

## Running it

The app to inspect must be a debug build started with `SILK_UI_INSPECT` set (see
[ui-inspect-server](../server/README.md#turning-it-on)). Every ui-app app run with
`runWindowWith` and an `Inspector` serves it; the owned todo demo (`modules/app/demo`), component
gallery (`modules/components/demo`) and inbox demo (`modules/tree/demo`) do.

```sh
silk task native devtools todo             # the todo demo and devtools
silk task native devtools external --app-binary /path/to/debug-app
SILK_UI_INSPECT=1 ui-app-demo &                            # or any app, then:
silk task native devtools run --connect 1   # 1, tcp:<port> or a socket path
```

### In the app's own process

Every app the native window host runs with the devtools as its companion can show them in its
own process, with no second program and no socket: every silk-ui app that runs through
ui-app-window, and a tree client that calls `host.runWindowWith` with
`EmbeddedDevtools.fromEnvironment()` (the direct-tree counter does). The app's code does not
change. In a debug build:

```sh
SILK_UI_DEVTOOLS=window ui-app-demo   # the todo demo, devtools in a window of their own
SILK_UI_DEVTOOLS=dock ui-app-demo     # docked at the bottom of the app's window
SILK_UI_DEVTOOLS=1 ui-app-demo        # a window where the host has windows, else the dock
SILK_UI_INSPECT=1 ui-app-demo         # closed at start; F12 opens them
silk task native devtools embedded    # the native check of both
```

F12 (Cmd+Option+I on macOS, Ctrl+Shift+I elsewhere) opens and closes them, with either variable
set; the app sees neither the press nor the release. Closing their window closes the devtools,
not the app. `SILK_UI_DEVTOOLS=0` keeps them closed and the shortcut off.

How (`embedded.silk`, an `EmbeddedDevtools`):

- They are a window host `Companion` (see [ui-tree-window](../../tree/window/README.md)): the
  devtools app runs in the app's tree, on root `DEVTOOLS_ROOT`, with ids counting up from
  `FIRST_ID` (`0xF0000000`), far above the ids clients choose, and a font family of their own.
  Their `Runtime` is placed there with `placeAt`, and their root is set aside in the tree, so
  the app's `takeEvents` never returns their records.
- They talk to the app's inspector over a local session (`Inspector.openLocal`), served on the
  spot: their commands are kept by the runtime (`deferCommands`) and performed between its
  passes, with a `Link` that serves each request before it returns. The socket inspector
  serves other clients at the same time.
- Their root is hidden from the inspector (`Inspector.hide`): their nodes are in no reply and
  their changes and frames push nothing, so they never inspect themselves or wake themselves up.
- Docked, they cover the bottom 45% of the window (160 to 420 points); the app is laid out above
  as if that were its window. The split is fixed.
- They draw with Geist and Geist Mono from the app's font collection (the fixtures' collection
  has them), under families of their own (`DEVTOOLS_FONT`, `DEVTOOLS_MONO`).

### The layout

The top bar, then the three columns, each scrolling on its own. Their window (`ui-devtools`, or
a window of the app's process) opens 1280 by 800. From 1180 points wide the
element tree is 320 wide and the inspector 340 (the design's widths), the middle takes the rest;
from 980, 280 and 320; from 820 (`STACKED_BELOW`), 240 and 300. Narrower than that the inspector
becomes the first tab of the middle column (**Inspector**), beside a tree of 36% of the width
(180 to 260). The dock is short and wide: it keeps all three columns, and each scrolls. The
devtools learn their width from their root box's layout (`Message.Resized`), so this holds in
their own window, in a window of the app's process, and docked. The middle column's tabs scroll
sideways when there are more than fit.

### Using them

The window connects to the address given with `--connect`, in the syntax of `SILK_UI_INSPECT` (default
`1`, the socket `silk-ui-inspect.sock` in the working directory). The app may start later or
restart: the status line says when it cannot be reached, and the devtools try again every
second until it answers.

- **Top bar**: Pick, the app's open roots (which one the tree shows), where the app is with its
  viewport, node count and protocol, Refresh, Live (its dot lit while live) and the frame.
- **Elements**: one row per node in tree order, its role or kind then its accessible name in
  quotes and test id in brackets, its size at the right. The triangle folds and unfolds a node's
  children. Pointing at a row washes its node in the app (and its size turns cyan); click a row
  to select it (amber, with a bar down its side; the app rings it); ArrowDown and ArrowUp move
  the selection, Escape clears it (and the highlight). The field above filters by role, name or
  test id, with the count of rows shown; selecting a node the filter or a fold hides shows it
  again and scrolls to it.
- **Pick**: the next click in the app's own window selects the node under the pointer instead
  of reaching the app; the app washes what the pointer is over meanwhile.
- **Inspector**: the selected node's kind, name and border-box size, and three segments.
  - **Design**: fields for the common properties, read from the node's computed style: width
    and height (a length, `Hug` or `Fill`), direction, gap, padding, align, fill, border,
    radius, font family (read only: families are ids the app defines), size and line height
    (`13 / 16`), weight. Type over one and press Enter: it becomes declarations
    (`padding: 4px 14px`) set with `setStyle`, an edit like any other, in the log. ArrowUp and
    ArrowDown step its last number (Shift 10, Alt 0.1) and set it at once. An edited field has
    an amber rule and dot. Then the other declarations the app sets on the base state that no
    field shows, the field to type more into (below), and this node's open edits as cards.
  - **Declarations**: type declarations (`width: 200px; color: red`) and press Enter or Apply to
    lay them over the node in the running app; one that does not parse is refused with the
    reason and changes nothing. The field completes property names (from the css package's
    catalog) and values (the property's initial value and the CSS-wide keywords) in a popup as
    you type; Tab takes the first, a click any. ArrowUp and ArrowDown step the last number of the
    last declaration and set it at once. Reset takes the node's edits back. Below, the box model
    (margin, border, padding and content as nested boxes with their widths, and the border box's
    position) and the node view of `inspect`: attributes, listeners, state, the style patches the
    client set for each state (base, hover, active, focus, focus-visible) and the computed style.
    An edit stays over what the app sets, also when the app restyles the node, until it is reset
    or resolved (see
    [Style edits and the edit log](../server/README.md#style-edits-and-the-edit-log)): it shows
    as a `style <state> edited` section in amber, marked down its side, and the app's
    declarations it hides are struck through.
  - **Edits**: the edit log as cards (the app as a whole for comments on no node): each edit's
    node and property, the app's value and the value tried, its state when not base, and whether
    it is no longer applied (its node is gone); each comment with its author and replies. Resolve
    says the code now does it (an edit stops being laid over the app), Reopen undoes that, Reset
    takes an edit back and out of the log, Reset all takes every edit back. A comment typed at
    the top goes to the selected node (the app when none is). The segment shows how many entries
    are open, and follows the app's `edits` topic. Devtools never change source: an agent reads
    the log (`ui_edits`), changes the code and resolves.
- **Events**: the event records the app took from the tree, newest first, with the target's
  label, the key or input value and the pointer position. Only kinds some node listens for
  are recorded (the tree queues nothing else). Clear empties the list.
- **Frames**: one bar per frame, layout over paint, against a 16.7 ms budget; frames over it
  are red. Below, the slowest and the average, then the last frame's `FrameStats` (layout
  passes and cache hits, replayed and repainted subtrees, glyphs, primitives).
- **Audit**: unnamed controls, clickable nodes without a role or out of the keyboard's reach,
  targets under 24 by 24 and text under WCAG contrast; the tab counts the issues. Click an
  issue to select its node.
- **The app's extension panels**, one tab each, as `hello` lists them (see
  [Extensions](../server/README.md#extensions)): panels with a view first, panels with data
  only after a rule, each with its extension's id. A panel with data only shows it with a
  generic view: an object's members and an array's elements in rows, nested ones indented,
  read when the tab opens and again when the panel's topic says it changed. A panel with a view
  shows what the app renders for it (below). A silk-ui program's **Program** panel is such a
  view: every message newest first, with what sent it (`click #12`, `port shell:menu`,
  `command Save`); beside them the model after the open message (the newest while none is), as
  its diff with the model before (lines added in amber, removed in red) or in full, and the
  commands `update` returned, each with the step it led to when one came of it; under the
  messages the program's counters and subscriptions, and Clear.

### Remote views

A panel with a view is rendered by the app, in its own framework (silk-ui's with its `Document`
builder), and only while a client has it open. When its tab opens the devtools subscribe to its
view topic; the app sends ordinary tree mutation batches on it, the first from nothing. A
`ViewHost` (`remote.silk`) replays them under the panel's box (test id `extension-view`) with
ids of the devtools' own, from `REMOTE_FIRST` (`0xF8000000`) up, and turns the app's `OpenRoot`
into an insert under that box. The view inherits the devtools' fonts, size, color and look; it
brings no resources of its own, and names the devtools' two faces by `font-family`
`VIEW_FONT_UI` (1) and `VIEW_FONT_MONO` (2), which the host maps to its families
(`ViewHost.fonts`). Its colors are its own: the Program panel repeats the few it needs from the
devtools' palette (`panel.silk`). The tree records events for those nodes as for any; the host
takes them out before the devtools' program sees them, maps them back to the app's ids and
sends them with `viewEvents`, and the app's panel answers them with another batch. A batch that
does not follow what was replayed (another view, a box drawn anew) asks the app for the whole
view again. Closing the tab unsubscribes: the app stops rendering it.

While **Live** is on (the default) the devtools subscribe to the app's `tree`, `roots`,
`events`, `pick` and `edits` topics, to `frame` while the Frames tab is open, and to an
extension panel's topic while its tab is open (its view topic, live or not). A
notification makes them read again only what it says changed: the element tree and the selected
node after `tree`, the event log after `events`, the open tab's numbers after `frame`, the
picker after `pick`, the edit log after `edits`. The status line comes with the notification itself. With Live off they
keep only `pick`. Refresh (or F5) reads everything once.

## The protocol it uses

A protocol 3 session (see [the server's protocol](../server/README.md#protocol)): `hello` with
`"protocol": 3` when it connects, `subscribe` and `unsubscribe` as notifications whenever Live
or the tab changes, and `highlight` as a notification on hover. Every other request carries an
`id`. Besides `hello`, `inspect`, `highlight` and `stats`, these commands came with the devtools.
Protocol 2 added `frames`, `styles`, `setStyle`, `resetStyles`, `pickMode` and `audit` (see the
[protocol table](../server/README.md#protocol)); against an older app those panels stay empty
and the rest works. An extension's commands (a data panel's) go out with `Link.ask`: the app
answers them when it next serves the extension, and the reply comes with the notifications.

- `tree`: every node (or a target's subtree) in tree order as node objects with `parent`,
  `depth` and `children`.
- `events`: the inspector's event log. An app feeds it by calling `Inspector.observe(&tree)`
  right before it takes the tree's records (ui-app-window does). `since` (a `seq`) and `limit`
  page through it; `next` is the `seq` the next record gets. ui-inspect-mcp has it as
  `ui_events`.

`inspect` replies also carry the box model as numbers (`box`: `margin`, `border`, `padding` and
`content` rects of the first fragment, and the fragment count).

## Tests

```sh
silk test --manifest-path modules/inspect/devtools/tests/silk.toml --root src/tests.silk
silk build --manifest-path modules/inspect/devtools/tests/silk.toml
build/llvm/x86_64-unknown-linux-gnu/debug/ui-inspect-devtools-tests modules/inspect/devtools/tests/goldens [--update]
silk task native devtools check
```

- The devtools run headless against the todo example over a `MemoryChannel` session, served
  by the same `Session` as the socket: the first refresh lists every node; clicking the Add
  button's row selects it, rings it in the app and shows its Design fields (padding `4 10`),
  declarations and box model (padding 10, border 1); hovering another row washes that node while
  the selection keeps its ring, and leaving the rows leaves the ring alone; a click sent to the app is pushed, and one pull reads the
  event log and the tree again, each record once; ArrowDown moves the selection and the
  highlight; Escape clears both; folding the root hides the rest; with Live off nothing is
  pushed or read; an app that cannot be reached shows in the status line and the next good
  refresh clears it. Then silk-ui's Program panel, a view the app renders: its nodes replayed
  with ids of the devtools' own, a click on a message going back to the app, which answers with
  the model diff, and closing the tab stopping the app's rendering. Then the frame bars, an
  audit, a style typed in and applied (and a bad one refused, and Reset), the filter, and a
  pick ending in a selection.
- Editing and the Edits segment (`changes.silk`): a property completes from the catalog and a
  value from the property's tables, ArrowUp steps the number and sets it in the app at once,
  Shift+ArrowDown by ten without moving the selection, Enter sets it; one edit from the app's
  10px, marked in the node view with the app's declaration struck; a comment from the selected
  node; the Edits segment lists both; the edit outlasts the app re-rendering; resolve takes it
  off the app, reopen lays it on again, Reset takes it out of the log, and a resolved comment
  stays. The Design fields: padding typed as `4 14` becomes the edit `padding: 4px 14px` in the
  app's log and on the node, the field is marked edited, and ArrowUp in the radius field logs
  `7px` over the app's 6px.
- The columns (`tests.silk`): the widths `columnsFor` gives from wide to narrow, the inspector
  becoming a tab of the middle column 700 wide (and giving it back for another tab), and all
  three columns in a short, wide dock.
- A notes extension that belongs to no framework: its panel is a tab, its data shows in rows,
  and is read again when its topic says it changed.
- Goldens (`describe` text and PNG, tolerance 2 per channel), at the design's 1440 by 900 but
  two: the Design segment (with a row pointed at), with edited fields and their cards, the
  completion popup open, the Declarations segment before and after an edit, the event log,
  silk-ui's Program panel (the app's view, replayed, a step opened by a click on it), the
  frames with the stats, the audit, the Edits segment (edits, one resolved, a comment with a
  reply and one on the app), the devtools docked (1280 by 360) and narrow enough to stack the
  inspector (720 by 520), and the todo app with the highlight the devtools asked for (the Add
  button ringed, the heading washed).
- The devtools in the todo example's own tree, driven as the window host drives them
  (`embedded.silk`): they list the app's nodes and none of theirs; another local client's
  `tree`, `query` and `hello` leave them out and `pick` finds the app's nodes; once settled,
  ten idle turns draw nothing and ask nothing; clicking the Add button's row highlights it in the
  app; adding a task shows its rows, then all is quiet again; F12 closes them (their highlight
  goes, the inspector turns off) and opens them again. Docked: the app's viewport is what the
  dock leaves, pointer input goes to the side it is on (a press keeps its side), the app's
  coordinates keep their origin and the devtools are hit only in the dock, and a click on a row
  in the dock highlights in the app, which draws again. With the app's silk-ui extension served
  on each turn, the Program tab replays the app's view in the devtools' root (ids from
  `REMOTE_FIRST`, hidden from other clients), shows a new message live, sends a click on a row
  back to the app, which opens the step's model, and closing the tab removes the view's nodes
  and stops the app's rendering.
- `check` is the exit test in real windows: it starts the owned todo demo and devtools,
  under Xvfb on Linux, and drives the tools through their own inspector with ui-inspect-cli.
  It discovers and selects Add, checks its ring, its Design padding field and
  `padding-left: 10px` and the box model in the Declarations segment, clicks Add, verifies the event log and new Task 4 in both element trees, reads
  the app's `silk-ui` extension with the CLI, opens the Program panel, which the app renders and
  the window replays over the socket, clicks a message in it and waits for the model diff, and
  captures both windows in `.cache/ui-inspect/`. Notes persistence and its
  application-specific devtools checks remain in the application repository.

## Limits

- In the app's process: the dock has a fixed size and sits at the bottom; a small window leaves
  the app little room. The docked devtools publish no accessibility tree. Their root box is
  placed with a style set on it after the runtime made it; a view whose root style changed would
  lose that until the next resize. The browser host has no inspector, so no devtools.

- A full refresh (start, Refresh, a new tab, Live on, after the app was away) is still six to
  eight requests, on the one session, and opens an open view again from nothing.
- A remote view travels without root options, resources, canvases, grids, anchors and virtual
  lists (`mutationFormat` 1). In the window, the `Layout` records of a view's nodes made during
  the devtools' own layout passes do not reach the app; pointer, key, focus and input records
  do.
- Edits are kept in the running app, not saved: they are for trying values and handing them to
  whoever changes the code. The Design fields show computed values, and font families as the
  ids the app gave them (`family 1`): the protocol does not carry the families' names. No
  design tokens yet: the fields show plain values.
- Completion knows property names and, for values, the initial value and the CSS-wide keywords:
  the css package has no table of each property's keywords. An edit of a longhand does not
  strike the app's shorthand it partly hides.
- Models are read, not restored: no time travel yet.
- No network or storage panels: a Silk app's effects are its commands, and those are in the
  Program panel.
- The window uses the tree fixtures' fonts: Geist and Geist Mono (Latin subsets), with Noto Sans
  behind them. Devtools in an app's process draw with the app's collection: an app whose
  collection has no Geist shows them in its fallback face.
- The tree has no `letter-spacing`, `text-transform` or `outline`: section labels are set in
  capitals in the text and without their tracking, and the highlight's rings are drawn by the
  overlay. The highlight in the app has no name tag (it would need glyphs the overlay, drawn
  after the tree's frame without its atlas, cannot make). The Program panel's messages show what
  sent them where the design shows how long `update` took: the runtime's journal does not time
  steps.
