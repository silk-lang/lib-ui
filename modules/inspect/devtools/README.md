# ui-inspect-devtools

A devtools window for a running Silk UI: the app's element tree on the left, and on the right
the selected node's styles (editable), the changes made (style edits and comments, for an agent
to carry into the code), its box model, the event log, a frame timeline, an accessibility audit
and the frame stats, then a tab for each panel the app's extensions add (a
silk-ui program's Program panel among them). Selecting an element highlights it in the app's
window with the devtools box model colors, and Pick selects whatever is clicked in the app's
window.

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
 in the syntax of `SILK_UI_INSPECT` (default
`1`, the socket `silk-ui-inspect.sock` in the working directory). The app may start later or
restart: the status line says when it cannot be reached, and the devtools try again every
second until it answers.

- **Elements**: one row per node in tree order, labelled the way devtools does (the role or the
  kind, the accessible name in quotes, the test id in brackets) with the id and the size. `-`
  folds a node's children, `+` unfolds them. Hovering a row highlights its node in the app (and
  leaving it gives the selection its highlight back); click a row to select it; ArrowDown and
  ArrowUp move the selection, Escape clears it (and the highlight). The field above filters by role,
  name or test id; selecting a node the filter or a fold hides shows it again and scrolls to it.
- **Pick**: the next click in the app's own window selects the node under the pointer instead
  of reaching the app; the app highlights what the pointer is over meanwhile.
- **Styles**: the node view of `inspect`: attributes, listeners, state, the box model in
  numbers, the style patches the client set for each state (base, hover, active, focus,
  focus-visible) and the computed style. Type declarations (`width: 200px; color: red`) and
  press Enter or Apply to lay them over the node in the running app; one that does not parse is
  refused with the reason and changes nothing. An edit stays over what the app sets, also when
  the app restyles the node, until it is reset or resolved (see
  [Style edits and the edit log](../server/README.md#style-edits-and-the-edit-log)): the panel
  shows it as a `style <state> edited` section, marked down its side, and strikes through the
  app's declarations it hides. The field completes property names (from the css package's
  catalog) and values (the property's initial value and the CSS-wide keywords) as you type;
  click a completion to take it. ArrowUp and ArrowDown step the last number of the last
  declaration by 1 (Shift 10, Alt 0.1) and set it at once, so a value can be tuned live. Reset
  takes the selected node's edits back. Below, a comment on the selected node goes to the edit
  log.
- **Changes**: the edit log, by node (the app as a whole for comments on no node): each edit's
  property, the app's value struck through and the value tried, its state when not base, and
  whether it is no longer applied (its node is gone); each comment with its author and replies.
  Resolve says the code now does it (an edit stops being laid over the app), Reopen undoes
  that, Reset takes an edit back and out of the log, Reset all takes every edit back. The tab
  shows how many entries are open, and the panel follows the app's `edits` topic. Devtools never
  change source: an agent reads the log (`ui_edits`), changes the code and resolves.
- **Box model**: margin, border, padding and content as nested boxes with their widths, in
  Chrome's colors, and the position of the border box.
- **Frames**: one bar per frame, layout over paint, against a 16.7 ms budget; frames over it
  are red. Below, the slowest and the average.
- **Audit**: unnamed controls, clickable nodes without a role or out of the keyboard's reach,
  targets under 24 by 24 and text under WCAG contrast. Click an issue to select its node.
- **Events**: the event records the app took from the tree, newest first, with the target's
  label, the key or input value and the pointer position. Only kinds some node listens for
  are recorded (the tree queues nothing else). Clear empties the list.
- **Stats**: the last frame's `FrameStats` (layout passes and cache hits, replayed and
  repainted subtrees, glyphs, primitives).
- **The app's extension panels**, one tab each, as `hello` lists them (see
  [Extensions](../server/README.md#extensions)). A panel with data only shows it with a generic
  view: an object's members and an array's elements in rows, nested ones indented, read when
  the tab opens and again when the panel's topic says it changed. A panel with a view shows what
  the app renders for it (below). A silk-ui program's **Program** panel is such a view: its
  counters and subscriptions, then every message newest first with what sent it (`click #12`,
  `port shell:menu`, `command Save`) and the commands `update` returned; a marker shows the
  steps that changed the model; click one for the model after it, with the lines it added and
  removed.

### Remote views

A panel with a view is rendered by the app, in its own framework (silk-ui's with its `Document`
builder), and only while a client has it open. When its tab opens the devtools subscribe to its
view topic; the app sends ordinary tree mutation batches on it, the first from nothing. A
`ViewHost` (`remote.silk`) replays them under the panel's box (test id `extension-view`) with
ids of the devtools' own, from `REMOTE_FIRST` (`0xF8000000`) up, and turns the app's `OpenRoot`
into an insert under that box. The view inherits the devtools' fonts, size, color and look; it
brings no resources of its own. The tree records events for those nodes as for any; the host
takes them out before the devtools' program sees them, maps them back to the app's ids and
sends them with `viewEvents`, and the app's panel answers them with another batch. A batch that
does not follow what was replayed (another view, a box drawn anew) asks the app for the whole
view again. Closing the tab unsubscribes: the app stops rendering it.

While **Live** is on (the default) the devtools subscribe to the app's `tree`, `roots`,
`events`, `pick` and `edits` topics, to `frame` while the Stats or Frames tab is open, and to an
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
  button's row selects it, highlights it in the app and shows its styles and box model
  (padding 10, border 1); hovering another row highlights that node, and leaving the rows gives
  the selection its highlight back; a click sent to the app is pushed, and one pull reads the
  event log and the tree again, each record once; ArrowDown moves the selection and the
  highlight; Escape clears both; folding the root hides the rest; with Live off nothing is
  pushed or read; an app that cannot be reached shows in the status line and the next good
  refresh clears it. Then silk-ui's Program panel, a view the app renders: its nodes replayed
  with ids of the devtools' own, a click on a message going back to the app, which answers with
  the model diff, and closing the tab stopping the app's rendering. Then the frame bars, an
  audit, a style typed in and applied (and a bad one refused, and Reset), the filter, and a
  pick ending in a selection.
- Editing and the Changes panel (`changes.silk`): a property completes from the catalog and a
  value from the property's tables, ArrowUp steps the number and sets it in the app at once,
  Shift+ArrowDown by ten without moving the selection, Enter sets it; one edit from the app's
  10px, marked in the Styles panel with the app's declaration struck; a comment from the selected
  node; the Changes panel lists both; the edit outlasts the app re-rendering; resolve takes it
  off the app, reopen lays it on again, Reset takes it out of the log, and a resolved comment
  stays.
- A notes extension that belongs to no framework: its panel is a tab, its data shows in rows,
  and is read again when its topic says it changed.
- Goldens (`describe` text and PNG, tolerance 2 per channel): the styles panel, the box model
  panel, the event log, silk-ui's Program panel (the app's view, replayed, a step opened by a
  click on it), frames and audit panels, the Changes panel (two edits, one resolved, a comment
  with a reply and one on the app), the styles of an edited node, and the todo app with the
  highlight the devtools asked for.
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
  It discovers and selects Add, checks highlighting and `padding-left: 10px`, opens the
  box model, clicks Add, verifies the event log and new Task 4 in both element trees, reads
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
  whoever changes the code. No design sidebar yet: edits are typed as declarations.
- Completion knows property names and, for values, the initial value and the CSS-wide keywords:
  the css package has no table of each property's keywords. An edit of a longhand does not
  strike the app's shorthand it partly hides.
- Models are read, not restored: no time travel yet.
- No network or storage panels: a Silk app's effects are its commands, and those are in the
  Program panel.
- The window uses the tree fixtures' fonts (Noto Sans), as the demos do.
