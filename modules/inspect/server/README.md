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

A thread accepts clients, and each connection gets a pump (`channel.bridge`, two threads: one
reads the socket, one writes) that queues its lines for the UI thread. The frame loop only
touches those queues: `poll` serves at most one waiting line per call, then yields to native
input and timers, so neither waiting for clients nor a slow client ever blocks it. Screenshot
rendering is synchronous.

`inspector.wakeWith(wake)` hands the inspector a `Wake` (the window host passes its `Nudge`,
the same one a `Poster` uses), and an arriving line ends the loop's wait for the next event;
`pollInterval` is then None while nothing waits, and 0 while lines wait. A host that never
calls `wakeWith` is polled: `pollInterval` says 20 ms.

```silk
let mut inspector = run Inspector.start(InspectorOptions.make())
run inspector.wakeWith(platform.nudge())             // a request line ends the wait below
while true {
  let wait = match inspector.pollInterval() {        // 0 while lines wait
    Option<f64>.Some { value } => Wait.Seconds { seconds: value }
    Option<f64>.None => Wait.Forever
  }
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
  run inspector.afterFrame(&tree)                    // before the uploads are cleared; pushes topics
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
(`afterFrame`), so every request sees the app's answer to the one before. `afterFrame` and
`poll` also send subscribed sessions their notifications; `wantsFrame` is true when a topic
changed again in a frame that already sent it, so it goes out with the next frame. Call `inspector.observe(&tree)` before every
`takeEvents` (window input too) so the `events` log sees what the app sees. `modules/tree/demo` is
the worked example; ui-app apps get all of this from `runWindowWith` in modules/app/window.

## Protocol

Protocol 3: JSON lines over a connection that stays open. Each line is a JSON object. A
request with an `id` (a number or a string) gets a reply with the same `id`; a line without one
is a notification and gets no reply. Replies have `"ok": true` and the command's members, or
`"ok": false` and an `error`. Lines from the app with an `event` member are notifications
(see Topics); a client ignores events it does not know.

A client opens a session by sending `hello` with `"protocol": 3` first:

```text
→ {"id":1,"cmd":"hello","protocol":3,"client":"devtools","wants":["tree","events"]}
← {"id":1,"ok":true,"protocol":3,"capabilities":{"commands":[...],"topics":[...],"sessions":true},"extensions":[],"roots":[...],...}
← {"event":"tree","frame":12,"width":360,"height":300,"scale":2,"nodes":40,"revision":7}
→ {"cmd":"highlight","nodes":[41]}          // no id, no reply
```

A connection whose first line is anything else is protocol 2: that one request is answered
(with or without an `id`), and the server closes the connection. So the CLI and scripts send
one request on a fresh connection, as before. A session over the same `Channel` in memory
(`MemoryChannel`, `Session.open()`) is open from the start.

`Protocol.handle` has no transport in it, and `Session` (`session.silk`) only a `Channel`
(`channel.silk`): `MemoryChannel` is a pair of line queues, `SocketChannel` is one whose other
end a pump joins to a socket (`client.openSession` connects one to an app).

### Topics

`subscribe` and `unsubscribe` take `topics` (names; all of them when left out) and answer with
the topics subscribed now; `hello` takes the same names in `wants`. Unknown names are ignored.
The app then sends `{"event": <topic>, "frame", ...}` when the topic changes, at most once per
topic per frame:

| topic | when | members |
| --- | --- | --- |
| `tree` | nodes, text, styles or geometry changed (the tree's `semanticRevision`) | `width`, `height`, `scale`, `nodes` (count), `revision` |
| `frame` | a frame was drawn | `width`, `height`, `scale`, `nodes` |
| `events` | the event log has new records | `next`: the `seq` the next record gets |
| `roots` | a root opened or closed | `roots`, as `tree` lists them |
| `highlight` | the highlight changed | `nodes` |
| `pick` | the picker turned on or off, or picked | `on`, `picked` (an id) |

Nothing is computed for a topic no session subscribed to.

Commands that pick a node take a target, either at the top level or in a `query` object:
`node` (the client id), `role` (the ARIA name `describe` prints: `button`, `listitem`, ...),
`name` (the accessible name), `label`, `text`, `testId`, `within` (a subtree), `exact` (whole
value, with case) and `hidden` (include hidden nodes). Text matches are trimmed,
case-insensitive substrings, as Playwright's locators. The first match in tree order wins.
Node objects in replies are `{"id", "kind", "role", "name", "testId", "x", "y", "width",
"height", "focused", "hovered"}` (CSS pixels; members are left out when empty or false).

| cmd | members | reply |
| --- | --- | --- |
| `hello` | `protocol` (3 opens a session), `client`, `wants` (topics) | `protocol` (3), `commands`, `capabilities` (`commands`, `topics`, `sessions`), `extensions` (none yet), `width`, `height`, `scale`, `frame`, `root`, `roots`, `nodes`, `highlight` |
| `subscribe` | `topics` | `topics`: subscribed now (sessions only) |
| `unsubscribe` | `topics` | `topics`: subscribed now (sessions only) |
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
| `tree` | target (optional, a subtree) | `nodes`: node objects in tree order, each with `parent` (left out at the top), `depth` and `children` (the count); `roots`: the open roots, `{"root", "node"}`, the current one first; `width`, `height`, `scale`, `frame` |
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
- Sessions over a `MemoryChannel`: replies by id (numbers and strings), a notification with no
  reply, `wants` and `subscribe` pushing `highlight` and `events`, two changes in one frame sent
  once with the next frame, `unsubscribe`, a one-shot first line, and closing one end.
- Over a real Unix socket (not on Windows): protocol 2 clients (hello, a click followed by a
  query that waits for the app's frame, a pending wait, bad JSON, `close` removing the socket
  file), and a protocol 3 session: several requests on one connection, a pushed topic, a
  one-shot client beside it, and the session ending with its connection.
- The MCP bridge over the same fixture (see [ui-inspect-mcp](../mcp/README.md#tests)).
- `demo inspect` (CI job `demo` in ui-inspect.yml): snapshot, click New by role and name, wait
  for the new row, highlight Archive, inspect it, screenshot to a PNG.

## Limits

- `wait` is answered `pending` and the client asks again (ui-inspect-cli does, every 50 ms),
  in a session too.
- A connection costs two pump threads, besides the one accept thread. Closing the inspector
  waits for them, up to a read pause (0.2 s).
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
