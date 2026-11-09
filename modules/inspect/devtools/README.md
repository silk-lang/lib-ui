# ui-inspect-devtools

A devtools window for a running Silk UI: the app's element tree on the left, and on the right
the selected node's styles, its box model, the event log and the frame stats. Selecting an
element highlights it in the app's window with the devtools box model colors.

It is built with the Silk framework itself ([ui-app](../../app)) and talks to the app only
through the inspector protocol ([ui-inspect-server](../server)), the same requests
ui-inspect-cli and ui-inspect-mcp send. So anything it shows, a script or an agent can read
too, and the devtools window is itself an app the inspector can drive.

Packages:

- `modules/inspect/devtools` (`ui-inspect-devtools`): the app (`devtools.silk`), what it reads out of
  the protocol's replies (`data.silk`) and the `Link` service it sends requests through
  (`link.silk`).
- `modules/inspect/devtools/app` (`ui-devtools`): the window, with a `Link` over the inspector socket.
- `modules/inspect/devtools/tests`: the devtools inspecting the todo example in the same process,
  and golden scenes.

## Running it

The app to inspect must be a debug build started with `SILK_UI_INSPECT` set (see
[ui-inspect-server](../server/README.md#turning-it-on)). Every ui-app app run with
`runWindowWith` and an `Inspector` serves it; the owned todo demo (`modules/app/demo`), component
gallery (`modules/components/demo`) and inbox demo (`modules/tree/demo`) do.

```sh
node modules/inspect/devtools/scripts/devtools todo             # the todo demo and devtools
node modules/inspect/devtools/scripts/devtools external --app-binary /path/to/debug-app
SILK_UI_INSPECT=1 ui-app-demo &                            # or any app, then:
node modules/inspect/devtools/scripts/devtools --connect 1      # 1, tcp:<port> or a socket path
```

`ui-devtools [--connect ADDRESS]` takes the address in the syntax of `SILK_UI_INSPECT` (default
`1`, the socket `silk-ui-inspect.sock` in the working directory). The app may start later or
restart: the status line says when it cannot be reached, and the next refresh picks it up.

- **Elements**: one row per node in tree order, labelled the way devtools does (the role or the
  kind, the accessible name in quotes, the test id in brackets) with the id and the size. `-`
  folds a node's children, `+` unfolds them. Click a row to select it; ArrowDown and ArrowUp
  move the selection, Escape clears it (and the highlight).
- **Styles**: the node view of `inspect`: attributes, listeners, state, the box model in
  numbers, the style patches the client set for each state (base, hover, active, focus,
  focus-visible) and the computed style.
- **Box model**: margin, border, padding and content as nested boxes with their widths, in
  Chrome's colors, and the position of the border box.
- **Events**: the event records the app took from the tree, newest first, with the target's
  label, the key or input value and the pointer position. Only kinds some node listens for
  are recorded (the tree queues nothing else). Clear empties the list.
- **Stats**: the last frame's `FrameStats` (layout passes and cache hits, replayed and
  repainted subtrees, glyphs, primitives).

While **Live** is on (the default) everything refreshes twice a second; Refresh (or F5) reads it
once.

## The protocol it uses

Besides `hello`, `inspect`, `highlight` and `stats`, two commands came with the devtools:

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
node modules/inspect/devtools/scripts/devtools check
```

- The devtools run headless against the todo example through `Protocol.handle`: the first
  refresh lists every node; clicking the Add button's row selects it, highlights it in the
  app and shows its styles and box model (padding 10, border 1); a click sent to the app shows
  in the event log once; ArrowDown moves the selection and the highlight; Escape clears both;
  folding the root hides the rest; Live off stops refreshes; an app that cannot be reached
  shows in the status line and the next good refresh clears it.
- Goldens (`describe` text and PNG, tolerance 2 per channel): the styles panel, the box model
  panel, the event log, and the todo app with the highlight the devtools asked for.
- `check` is the exit test in real windows: it starts the owned todo demo and devtools,
  under Xvfb on Linux, and drives the tools through their own inspector with ui-inspect-cli.
  It discovers and selects Add, checks highlighting and `padding-left: 10px`, opens the
  box model, clicks Add, verifies the event log and new Task 4 in both element trees,
  and captures both windows in `.cache/ui-inspect/`. Notes persistence and its
  application-specific devtools checks remain in the application repository.

## Limits

- One request per connection (the server's limit for now), so a refresh is five round trips;
  fine locally, and it moves to one persistent connection when the server gets them.
- The app's own pointer cannot pick an element yet (devtools' element picker): that needs the
  app's window to forward a click to the inspector instead of the app.
- Styles are read only; editing a declaration would be a `setStyle` request the protocol does not
  have yet.
- The window uses the tree fixtures' fonts (Noto Sans), as the demos do.
