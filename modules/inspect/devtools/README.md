# ui-inspect-devtools

A devtools window for a running Silk UI: the app's element tree on the left, and on the right
the selected node's styles (editable), its box model, the program's messages with the model
diff each one made, the event log, a frame timeline, an accessibility audit and the frame
stats. Selecting an element highlights it in the app's window with the devtools box model
colors, and Pick selects whatever is clicked in the app's window.

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
silk task native devtools todo             # the todo demo and devtools
silk task native devtools external --app-binary /path/to/debug-app
SILK_UI_INSPECT=1 ui-app-demo &                            # or any app, then:
silk task native devtools run --connect 1   # 1, tcp:<port> or a socket path
```

`ui-devtools [--connect ADDRESS]` takes the address in the syntax of `SILK_UI_INSPECT` (default
`1`, the socket `silk-ui-inspect.sock` in the working directory). The app may start later or
restart: the status line says when it cannot be reached, and the next refresh picks it up.

- **Elements**: one row per node in tree order, labelled the way devtools does (the role or the
  kind, the accessible name in quotes, the test id in brackets) with the id and the size. `-`
  folds a node's children, `+` unfolds them. Click a row to select it; ArrowDown and ArrowUp
  move the selection, Escape clears it (and the highlight). The field above filters by role,
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

While **Live** is on (the default) everything refreshes twice a second; Refresh (or F5) reads it
once.

## The protocol it uses

Besides `hello`, `inspect`, `highlight` and `stats`, these commands came with the devtools.
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

- The devtools run headless against the todo example through `Protocol.handle`: the first
  refresh lists every node; clicking the Add button's row selects it, highlights it in the
  app and shows its styles and box model (padding 10, border 1); a click sent to the app shows
  in the event log once; ArrowDown moves the selection and the highlight; Escape clears both;
  folding the root hides the rest; Live off stops refreshes; an app that cannot be reached
  shows in the status line and the next good refresh clears it. Then the reported program:
  three steps, the model diff of one, the frame bars, an audit, a style typed in and applied
  (and a bad one refused, and Reset), the filter, and a pick ending in a selection.
- Goldens (`describe` text and PNG, tolerance 2 per channel): the styles panel, the box model
  panel, the event log, the program, frames and audit panels, and the todo app with the
  highlight the devtools asked for.
- `check` is the exit test in real windows: it starts the owned todo demo and devtools,
  under Xvfb on Linux, and drives the tools through their own inspector with ui-inspect-cli.
  It discovers and selects Add, checks highlighting and `padding-left: 10px`, opens the
  box model, clicks Add, verifies the event log and new Task 4 in both element trees,
  and captures both windows in `.cache/ui-inspect/`. Notes persistence and its
  application-specific devtools checks remain in the application repository.

## Limits

- One request per connection (the server's limit for now), so a refresh is six to eight round trips;
  fine locally, and it moves to one persistent connection when the server gets them.
- A style edit lasts until the app next sets that node's style; it is for trying a value, not
  for keeping it.
- Models are read, not restored: no time travel yet.
- No network or storage panels: a Silk app's effects are its commands, and those are in Program.
- The window uses the tree fixtures' fonts (Noto Sans), as the demos do.
