# ui-inspect-server

The inspector protocol for [ui-tree](../../tree): a running Silk UI answers JSON requests on a
local socket, so a person, a script or an agent can snapshot it, look at any node the way
devtools does, take screenshots and drive it with input. It sits on top of the inspector core
in [ui-inspect](..). The CLI that talks to it is [ui-inspect-cli](../cli), and
[ui-inspect-mcp](../mcp) serves it to agents as MCP tools. The `client` module (connect, send a
request, read the reply) and the MCP bridge (`mcp`) live here too, so both share them.

## Turning it on

It is off unless both hold:

- the app is a debug build (`optimization = "none"`; `InspectorOptions.releaseBuilds` lifts this
  for tests), and
- `SILK_UI_INSPECT` is set:
  - `1`: the Unix socket `silk-ui-inspect.sock` in the working directory (TCP port 7357 on
    Windows, where std has no Unix sockets)
  - `tcp:<port>`: TCP on 127.0.0.1 only (`tcp:0` lets the system choose; the port is printed)
  - anything else: the path of a Unix socket

When it starts it prints `ui-inspect: listening on ...` to stderr. A socket file left by a crash
is removed when nothing answers on it.

## In the app's frame loop

The server is polled from the window loop. It serves at most one waiting request per poll,
then yields to native input and timers. Screenshot rendering is synchronous; connected socket
reads/writes have bounded deadlines. Waiting for future clients never blocks the frame loop.
The poll clock probes socket readiness without waiting and advances to its deadline when nothing
is ready, preserving this behavior with Silk's `MonotonicClock.waitReady` interface.

```silk
let mut inspector = run Inspector.start(InspectorOptions.make())
let wait = match inspector.pollInterval() {          // wake up to serve requests while idle
  Option<f64>.Some { value } => Wait.Seconds { seconds: value }
  Option<f64>.None => Wait.Forever
}
while true {
  let next = run platform.nextEvent(wait)
  if run inspector.poll(&mut tree) {                 // a request dispatched input or highlighted
    while true {
      // Service host requests (clipboard/IME), then react just as for native input.
      run inspector.observe(&tree)
      run tree.takeEvents(&mut records)
      ...
      if !run inspector.dispatchNext(&mut tree) { break }
    }
    platform.requestFrame(window)
  }
  ...
  run tree.frame(input)
  // upload tree.pendingUploads() to the GPU, then:
  run inspector.afterFrame(&tree)                    // before the uploads are cleared
  run renderer.draw(..., inspector.scene(&tree), ...) // the frame, with the highlight on top
}
run inspector.close()
```

A compound click/type/press queues individual `ui_tree.Input` values. `poll` dispatches the
first through `UiTree.dispatch`, the same entry point used by the native window adapter.
Drain `dispatchNext` **with the host/application reaction between every event**, so a down
handler's focus, capture, or view changes apply before up. Protocol-only integrations use
`Protocol.dispatchNext` with the same contract. No input command calls application actions.

After a request dispatches input, the next request waits until the app has drawn a frame
(`afterFrame`), so every request sees the app's answer to the one before. Call `inspector.observe(&tree)` before every
`takeEvents` (window input too) so the `events` log sees what the app sees. `modules/tree/demo` is
the worked example; ui-app apps get all of this from `runWindowWith` in modules/app/window.

## Protocol

One request per connection: the client writes one JSON object and a newline, the server writes
one JSON object and a newline and closes the connection. (std's `accept` only lends a
connection to a callback, so a connection cannot stay open across frames yet; a later std
change can keep it open without changing the messages.)

Requests have a `cmd` and an optional `id` (a number or a string) that the reply echoes.
Replies have `"ok": true` and the command's members, or `"ok": false` and an `error`.

Commands that pick a node take a target, either at the top level or in a `query` object:
`node` (the client id), `role` (the ARIA name `describe` prints: `button`, `listitem`, ...),
`name` (the accessible name), `label`, `text`, `testId`, `within` (a subtree), `exact` (whole
value, with case) and `hidden` (include hidden nodes). Text matches are trimmed,
case-insensitive substrings, as Playwright's locators. The first match in tree order wins.
Node objects in replies are `{"id", "kind", "role", "name", "testId", "x", "y", "width",
"height", "focused", "hovered"}` (CSS pixels; members are left out when empty or false).

| cmd | members | reply |
| --- | --- | --- |
| `hello` | | `protocol` (2), `commands`, `width`, `height`, `scale`, `frame`, `root`, `nodes`, `highlight` |
| `snapshot` | target (optional, a subtree), `styles` | `text`: `describe` output, `frame` |
| `query` | target, `limit` | `count`, `nodes` (node objects, tree order) |
| `inspect` | target, `patches`, `computed` | `node`, `text`: the devtools-style node view; `box`: the `margin`, `border`, `padding` and `content` rects of the first fragment and the `fragments` count (left out when the node has no box) |
| `pick` | `x`, `y` | `node` (what the element picker selects), `path` (ids hit testing reaches) |
| `highlight` | `nodes` (ids) or a target (all matches); none clears it | `nodes` highlighted |
| `screenshot` | target (optional: that node alone, cropped), `highlight` (default true), `maxWidth` (optional 1–4096, reduce before encoding) | `png` (Base64), `width`, `height` (device pixels), `scale`, `frame`, `node` |
| `click` | target or `x`, `y`; `count`, `modifiers` | `node`, `x`, `y` |
| `hover` | target or `x`, `y`; `modifiers` | `node`, `x`, `y` |
| `scroll` | target or `x`, `y`; `dx`, `dy` (positive scrolls down); `modifiers` | `node`, `x`, `y` |
| `pointer` | target or `x`, `y`; `phase`: `down`, `move`, `up`; `button` (0 primary, 1 middle, 2 secondary); `count` on down, `modifiers` | `node`, `x`, `y` |
| `key` | `phase`: `down` or `up`; `key`, `code`, `modifiers`, `repeat` on down | `key` |
| `press` | `key` (UI Events key), `code` (defaults to the key), `modifiers`, `times` | `key` |
| `type` | `text` (as `TextInput` records to the focused input; newlines and tabs as Enter and Tab); a target in `query` is clicked first | `typed` (characters) |
| `wait` | target, `gone`, `timeout` (ms) | `node`, or `"pending": true` when it does not hold yet |
| `stats` | | the last frame's `FrameStats`: nodes, fragments, layout counters, replayed and repainted subtrees, glyphs, primitives |
| `tree` | target (optional, a subtree) | `nodes`: node objects in tree order, each with `parent` (left out at the top), `depth` and `children` (the count); `width`, `height`, `scale`, `frame` |
| `events` | `since` (a `seq`, default 0), `limit` (the newest N) | `events`: the logged records after `since`, oldest first, each `{"seq", "frame", "kind", "target", "path"}` plus `x`, `y` (pointer, wheel and scroll records), `modifiers`, `key` and `value` (input records) where they apply; `next`: the `seq` the next record gets |
| `program` | | `attached`; `steps` held with the `first` and `last` seq; the `model` now, as text; `subscriptions`; `stats`: `renders`, `dispatches`, `messages`, `commands`, `mutations`, `nodes`, `reused` |
| `messages` | `since` (a `seq`), `limit` | `messages`: the steps after `since`, oldest first, each `{"seq", "time", "cause", "message", "commands", "changed"}`; `next` |
| `model` | `seq` (default: the last step) | `model`: the model after that step, one line per field; `diff`: `{"op": " "\|"+"\|"-", "line"}` against the step before; `changed` (lines) |
| `frames` | `since` (a frame number), `limit` | `frames`: one per frame drawn, `{"frame", "layoutMs", "paintMs", "layoutSkipped", "layoutPasses", "repainted", "replayed", "fragments", "primitives", "glyphs", "nodes"}`; `count`, `slowestMs`, `averageMs` (times are 0 when the host does not time frames) |
| `styles` | target | `node`, and its style patches as declarations: `base`, `hover`, `active`, `focus`, `focus-visible` |
| `setStyle` | target, `style` (`"width: 200px; color: red"`), `state` (default `base`), `replace` | `node`, `state`, `style` as set, `edited` (node and state pairs edited so far); a declaration that does not parse is an error and changes nothing |
| `resetStyles` | | `restored`: every edit undone |
| `pickMode` | `on` (left out: just asks) | `on`; `picked`: the node the last pick chose. While on, the app's own pointer highlights what it is over and the next click selects it instead of reaching the app |
| `audit` | target (optional, a subtree) | `issues`: `{"rule", "message", "node"}` for `unnamed`, `no-role`, `not-focusable`, `small-target` (under 24 by 24) and `contrast` (under 4.5, or 3 for large text); `count`, `checked` |

The program commands answer for what the host reported: `Inspector.report` takes a
`ProgramLog` (ui-app's window host fills it from the program's journal after every step) and
`inspector.timed(layout, paint)` gives the frame about to be recorded its times. A host that
reports nothing answers `"attached": false` and frames without times. Style edits live in the tree
like any patch; the app's next render of that node's style wins over them.

`key` down/up tracks held Shift/Control/Alt/Meta for subsequent commands that omit `modifiers`. Explicit `modifiers` overrides the event snapshot.

`modifiers` is a list of `shift`, `control` (or `ctrl`), `alt`, `meta`. Pointer input goes to
the point `pointOf` finds (the centre of the node's visible box, or a grid point that hit
testing reaches); a node that is hidden, scrolled out of view or covered is an error.

Screenshots are the CPU reference rendering of the tree's last frame (the same pixels the GPU
draws, within tolerance), over a transparent background. An app with its own canvas should call
`afterFrameScene(&tree, &composedScene)` and draw `sceneWith(&composedScene)` instead. Captures
then include the canvas; a node target crops the composed viewport to that node's bounds.
Highlights also appear over the composed scene. Tree-only hosts retain isolated-subtree captures.

Hosts must compose a logical frame while inspected even when an occluded window has no display
callback. `ui-app/window` does this without acquiring an invisible GPU surface. The
frame number identifies composition, not proof of physical screen presentation.

Timed mosaics are a **client operation**, available through MCP `ui_capture` and CLI `capture`.
The client takes repeated `screenshot` samples, preserving repeated source frame numbers and
actual elapsed times. It waits outside the app and returns one PNG contact sheet; no sleeps
are introduced into the app's event loop. CPU capture itself has a cost, so use the sequence
to diagnose visual state changes, not to measure FPS.

```text
$ SILK_UI_INSPECT=1 ui-tree-demo &
$ ui-inspect-cli click --role button --name New
{"id":1,"ok":true,"node":10,"x":39.68,"y":27.5}
$ ui-inspect-cli wait --text "A new message"
$ ui-inspect-cli screenshot inbox.png
```

## Tests

```sh
silk test --manifest-path modules/inspect/server/tests/silk.toml --root src/tests.silk
silk task native inspect      # the CLI drives the demo in a window
```

- Every command through `Protocol.handle` over the inbox fixture: snapshot equals `describe`,
  inspect equals `inspectNode`, queries by role and name, pick, highlight and screenshots (with
  and without the overlay, one node cropped), click (the app sees the click record), Tab,
  scroll, type, wait (holds, pending, gone, timed out) and the error replies.
- Over a real Unix socket (not on Windows): hello, a click followed by a query that waits for the app's frame,
  a pending wait, bad JSON, and `close` removing the socket file.
- The MCP bridge over the same fixture (see [ui-inspect-mcp](../mcp/README.md#tests)).
- `demo inspect` (CI job `demo` in ui-inspect.yml): snapshot, click New by role and name, wait
  for the new row, highlight Archive, inspect it, screenshot to a PNG.

## Limits

- One request per connection (see above); `wait` is answered `pending` and the client asks
  again (ui-inspect-cli does, every 50 ms).
- `type` sends `TextInput` records (Enter and Tab for newlines and tabs); IME preedit is not driven.
- The program log keeps the last 200 steps and the timeline the last 240 frames. A model is
  text (what `show` prints), so `model` diffs lines, not values, and there is no time travel:
  an old model can be read, not put back.
- The event log keeps the last 500 records the app took (`Inspector.observe`); input the
  tree did not queue a record for (no node listens) is not in it. No session recording over
  the wire yet; sessions are still in memory
  (ui-inspect's `Session`).
- Screenshots come from the CPU renderer, not a GPU readback.
- The highlight has no name tag over the node.
