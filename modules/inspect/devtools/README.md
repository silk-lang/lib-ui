# ui-inspect-devtools

A devtools window for a running Silk UI: the app's element tree on the left, and on the right
the selected node's styles (editable), its box model, the program's messages with the model
diff each one made, the event log, a frame timeline, an accessibility audit and the frame
stats. Selecting an element highlights it in the app's window with the devtools box model
colors, and Pick selects whatever is clicked in the app's window.

It is built with the Silk framework itself ([ui-app](../../app)) and talks to the app only
through the inspector protocol ([ui-inspect-server](../server)), the same requests
ui-inspect-cli and ui-inspect-mcp send. So anything it shows, a script or an agent can read
too, and the devtools window is itself an app the inspector can drive. It keeps one protocol 3
session open with the app, subscribes to its topics, and reads again only what the app says
changed.

Packages:

- `modules/inspect/devtools` (`ui-inspect-devtools`): the app (`devtools.silk`), what it reads out of
  the protocol's replies (`data.silk`) and the `Link` service it talks through (`link.silk`):
  requests numbered by `Requests` over the client end of a `Channel`, notifications, and what
  the app pushed. `embedded.silk` runs the same app in the inspected app's own process.
- `modules/inspect/devtools/app` (`ui-devtools`): the window, with a `Link` over a
  `SocketChannel` session. The pump thread rings a bell that wakes the window, which sends the
  devtools `Message.Pull`.
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
  press Enter or Apply to set them on the node in the running app; one that does not parse is
  refused with the reason and changes nothing. Reset undoes every edit.
- **Box model**: margin, border, padding and content as nested boxes with their widths, in
  Chrome's colors, and the position of the border box.
- **Program**: for an app built on ui-app's `Program`: its counters and subscriptions, then
  every message newest first with what sent it (`click #12`, `port shell:menu`, `command
  Save`) and the commands `update` returned. A marker shows the steps that changed the model;
  click one for the model after it, with the lines it added and removed. Nothing in the app is
  written for this: messages, commands and models are printed by reflection.
- **Frames**: one bar per frame, layout over paint, against a 16.7 ms budget; frames over it
  are red. Below, the slowest and the average.
- **Audit**: unnamed controls, clickable nodes without a role or out of the keyboard's reach,
  targets under 24 by 24 and text under WCAG contrast. Click an issue to select its node.
- **Events**: the event records the app took from the tree, newest first, with the target's
  label, the key or input value and the pointer position. Only kinds some node listens for
  are recorded (the tree queues nothing else). Clear empties the list.
- **Stats**: the last frame's `FrameStats` (layout passes and cache hits, replayed and
  repainted subtrees, glyphs, primitives).

While **Live** is on (the default) the devtools subscribe to the app's `tree`, `roots`,
`events` and `pick` topics, and to `frame` while the Stats, Frames or Program tab is open. A
notification makes them read again only what it says changed: the element tree and the selected
node after `tree`, the event log after `events`, the open tab's numbers after `frame`, the
picker after `pick`. The status line comes with the notification itself. With Live off they
keep only `pick`. Refresh (or F5) reads everything once.

## The protocol it uses

A protocol 3 session (see [the server's protocol](../server/README.md#protocol)): `hello` with
`"protocol": 3` when it connects, `subscribe` and `unsubscribe` as notifications whenever Live
or the tab changes, and `highlight` as a notification on hover. Every other request carries an
`id`. Besides `hello`, `inspect`, `highlight` and `stats`, these commands came with the devtools.
Protocol 2 added `program`, `messages`, `model`, `frames`, `styles`, `setStyle`, `resetStyles`,
`pickMode` and `audit` (see the [protocol table](../server/README.md#protocol)); against an
older app those panels stay empty and the rest works.

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
  refresh clears it. Then the reported program:
  three steps, the model diff of one, the frame bars, an audit, a style typed in and applied
  (and a bad one refused, and Reset), the filter, and a pick ending in a selection.
- Goldens (`describe` text and PNG, tolerance 2 per channel): the styles panel, the box model
  panel, the event log, the program, frames and audit panels, and the todo app with the
  highlight the devtools asked for.
- The devtools in the todo example's own tree, driven as the window host drives them
  (`embedded.silk`): they list the app's nodes and none of theirs; another local client's
  `tree`, `query` and `hello` leave them out and `pick` finds the app's nodes; once settled,
  ten idle turns draw nothing and ask nothing; clicking the Add button's row highlights it in the
  app; adding a task shows its rows, then all is quiet again; F12 closes them (their highlight
  goes, the inspector turns off) and opens them again. Docked: the app's viewport is what the
  dock leaves, pointer input goes to the side it is on (a press keeps its side), the app's
  coordinates keep their origin and the devtools are hit only in the dock, and a click on a row
  in the dock highlights in the app, which draws again.
- `check` is the exit test in real windows: it starts the owned todo demo and devtools,
  under Xvfb on Linux, and drives the tools through their own inspector with ui-inspect-cli.
  It discovers and selects Add, checks highlighting and `padding-left: 10px`, opens the
  box model, clicks Add, verifies the event log and new Task 4 in both element trees,
  and captures both windows in `.cache/ui-inspect/`. Notes persistence and its
  application-specific devtools checks remain in the application repository.

## Limits

- In the app's process: the dock has a fixed size and sits at the bottom; a small window leaves
  the app little room. The docked devtools publish no accessibility tree. Their root box is
  placed with a style set on it after the runtime made it; a view whose root style changed would
  lose that until the next resize. The browser host has no inspector, so no devtools.

- A full refresh (start, Refresh, a new tab, Live on, after the app was away) is still six to
  eight requests, on the one session. The Program tab's messages are read with `tree` and
  `frame` notifications while it is open; a program topic comes with silk-ui's extension.
- A style edit lasts until the app next sets that node's style; it is for trying a value, not
  for keeping it.
- Models are read, not restored: no time travel yet.
- No network or storage panels: a Silk app's effects are its commands, and those are in Program.
- The window uses the tree fixtures' fonts (Noto Sans), as the demos do.
