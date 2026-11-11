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

A client in the app's own process needs neither: `inspector.openLocal()` opens a session over a
`MemoryChannel`, open from the start, and returns the client's end. It turns the inspector on
(even one that is `off`) until the client closes its end, and `serveLocal(&mut tree)` serves its
lines on the spot, so the client can wait for a reply on the same thread. The socket, if there
is one, keeps serving its clients beside it. The in-process devtools (ui-inspect-devtools'
`embedded`) are such a client.

### Hidden roots

`inspector.hide(root, true)` leaves a root out of everything the inspector serves, for a client
that draws in the inspected tree and must not inspect itself:

- `tree`, `hello`, `roots` and the `roots` topic do not list it (`hello` names it in `hidden`),
  and the `nodes` counts of `hello`, `stats` and the topics leave its nodes out;
- no query, target (`node` too), `within`, `wait` or `highlight` finds its nodes;
- its records are not logged (`events`);
- its changes and frames are no news: the `tree` topic follows the revisions of the roots shown
  (`UiTree.revisionOf`), and `frame` the frames of the current root, so a client drawing in a
  hidden root is not woken by its own drawing.

Requests are served with a root that is not hidden current (the window host keeps the first one
current), as `pick` and screenshots are about the current root.

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
← {"id":1,"ok":true,"protocol":3,"capabilities":{"commands":[...],"topics":[...],"sessions":true},"mutationFormat":1,"extensions":[...],"roots":[...],...}
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

`subscribe` and `unsubscribe` take `topics` (names; all of them when left out, but extensions'
view topics) and answer with the topics subscribed now; `hello` takes the same names in `wants`.
Unknown names are ignored. Extension topics are subscribed to by their full name
(`<id>.<topic>`, see Extensions).
The app then sends `{"event": <topic>, "frame", ...}` when the topic changes, at most once per
topic per frame:

| topic | when | members |
| --- | --- | --- |
| `tree` | nodes, text, styles or geometry of a root shown changed (the sum of their `revisionOf`) | `width`, `height`, `scale`, `nodes` (count), `revision` |
| `frame` | a frame of the current root was drawn | `width`, `height`, `scale`, `nodes` |
| `events` | the event log has new records | `next`: the `seq` the next record gets |
| `roots` | a root opened or closed | `roots`, as `tree` lists them |
| `highlight` | the highlight changed | `nodes` |
| `pick` | the picker turned on or off, or picked | `on`, `picked` (an id) |
| `edits` | the edit log changed (see Style edits and the edit log) | `seq` (the log's), `open` (entries open) |

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
| `hello` | `protocol` (3 opens a session), `client`, `wants` (topics) | `protocol` (3), `commands`, `capabilities` (`commands`, `topics`, `sessions`; the extensions' with their full names), `mutationFormat` (1), `extensions` (see Extensions), `width`, `height`, `scale`, `frame`, `root`, `roots`, `hidden` (roots left out), `nodes`, `highlight` |
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
| `frames` | `since` (a frame number), `limit` | `frames`: one per frame drawn, `{"frame", "layoutMs", "paintMs", "layoutSkipped", "layoutPasses", "repainted", "replayed", "fragments", "primitives", "glyphs", "nodes"}`; `count`, `slowestMs`, `averageMs` (times are 0 when the host does not time frames) |
| `styles` | target | `node`; the declarations it shows per state (`base`, `hover`, `active`, `focus`, `focus-visible`): the client's with the style edits over them; for the states with edits, `overrides` (the edits' declarations), `client` (the client's own underneath) and `replacing` (states whose edit leaves the client's out) |
| `setStyle` | target, `style` (`"width: 200px; color: red"`), `state` (default `base`), `replace` | `node`, `state`, `style` (what it shows now), `edited` (node and state pairs with edits), `edits` (the ids of the node's open edits in that state), `seq`; a declaration that does not parse is an error and changes nothing |
| `resetStyles` | target (optional), `state`, `property` (with a target) | `restored` (pairs or properties showing the client's declarations again), `removed` (open edits taken out of the log), `seq` |
| `edits` | `status` (`open`, `resolved`; both without it), `kind` (`edit`, `comment`), `since` (a `seq`) | `seq`, `open`, `edits`, `comments` (see the edit log) |
| `comment` | `text`, `author`, and a target (none: the app as a whole) or `reply` (a comment's id) | `entry`: the comment, `seq` |
| `resolve` | `entry` (an id) or `entries` (ids), `reopen` | `entries`: each entry now, `seq`; an unknown id is an error and changes nothing |
| `pickMode` | `on` (left out: just asks) | `on`; `picked`: the node the last pick chose. While on, the app's own pointer highlights what it is over and the next click selects it instead of reaching the app |
| `audit` | target (optional, a subtree) | `issues`: `{"rule", "message", "node"}` for `unnamed`, `no-role`, `not-focusable`, `small-target` (under 24 by 24) and `contrast` (under 4.5, or 3 for large text); `count`, `checked` |
| `viewEvents` | `topic` (an extension view topic), `events` (records, see `remote.silk`) | `queued`: the records queued for the view (none while nobody has it open) |
| `<id>.<command>` | the extension's | the extension's, when the app next serves it (see Extensions) |

`inspector.timed(layout, paint)` gives the frame about to be recorded its times; a host that
does not time its frames records them without.

### Style edits and the edit log

`setStyle` does not change the client's declarations. It lays the edit over them through the
tree's override layer (`UiTree.setOverride`, a tree-level hook with no inspector in it): the tree
keeps an override per node and state, merges it over the client's declarations when it resolves
the node's style (as `css.set` would, or instead of them with `replace`), and drops it when the
node is destroyed. So the client restyling the node (`SetStyle`, `ClearStyle`) changes only what
lies underneath, and the edit stays until it is reset or resolved; a reset shows exactly what the
client set last, also while it was overridden. Nothing is applied again: no mutation, no record
and no notification reaches the client, an edit changes only the revision of the root that holds
its node, and once drawn it asks for no frame. While there are no overrides, styles resolve as
before; hover and press restyle a node with an override in that state as they do one with a
client style for it.

Each property an edit sets is an entry of the edit log, which the inspector keeps for the app's
lifetime (`Protocol.edits`), whatever sessions come and go. An entry is an edit or a comment:

```text
edit    {"id","seq","kind":"edit","status","target","state","property","before","after","origin","applied"}
comment {"id","seq","kind":"comment","status","target","text","author","thread":[{"seq","text","author"}]}
```

- `id` is one sequence for edits and comments; `seq` is the log's change counter when the entry
  last changed (the log's `seq` grows with every change: `edits` with `since` reads on).
- `status` is `open` or `resolved`.
- An edit is one property of one node in one state. `before` is the client's value when it was
  made (null when the client set none; a shorthand covering the property does not count),
  `after` the value tried (null when a `replace` leaves the client's out). Setting the property
  again changes the open edit's `after`; setting it to what the client shows takes the edit out
  of the log and its declaration out of the override. `applied` is false once the edit's node
  was destroyed (its override went with it). `origin` is `inline`, or `token` for design tokens
  (reserved).
- `target` is the node as it was: `root`, `node`, `path` (ids from the root's node down),
  `element` (a node object), `named` (the nearest node at or above it with a test id, label or
  accessible name, with its `label`) and `keys` (`{"id","testId"}` along the path; the test ids
  are the only keys the tree has). There is no `source` yet: the tree does not know where a node
  was built.

`resolve` says the code now does what an entry asks. Resolving an edit takes its declaration out
of the node's override, so the node shows what the client sets (the new code's value once the
app runs it); reopening lays it over again, when the node is there and no newer edit of the
property is open. `resetStyles` takes edits back and their open entries out of the log; resolved
entries and comments stay.

### Extensions

The inspector knows the tree and nothing else: a framework (or any code that drives the tree)
adds what it knows through an extension (`extension.silk`). It registers once and is served
from the app's loop, on the app's thread:

```silk
let mut info = run Extension.make("router", "1.0")
run info.command("routes")                       // served as router.routes
run info.topic("navigated")                      // pushed as router.navigated
run info.tool("routes", "Routes", "The app's routes.", "", true)  // its MCP description
run info.panel("routes", "Routes", "routes", "navigated", false)  // a devtools tab, data only
run inspector.extend(move info)
...
// on every turn of the loop, while the inspector is on:
run inspector.serveExtension("router", &mut router)  // router: an ExtensionHandler
```

`ExtensionHandler` has three methods: `command(name, request, out)` writes a whole reply line
(`reply.begin` … `reply.finish`) or returns false for a command it does not know; `topics(news)`
posts the topics that changed (`news.post("navigated", "{\"to\":\"/a\"}")`); `view(panel, view)`
renders a panel's view. The last two do nothing by default.

- **Commands** are served as `<id>.<command>`. Such a request waits until the app next serves
  the extension (`pollInterval` is 0 meanwhile), and the reply goes to the session that asked;
  a protocol 2 connection stays open until then. An unknown command of a known extension is
  answered `unknown cmd` at once.
- **Topics** are pushed as `{"event":"<id>.<topic>","frame",...members}` to the sessions that
  subscribed, at most once a frame as the inspector's own; news nobody subscribed to is dropped.
- **Panels** have two faces. `data` names a command whose reply is the panel's JSON: devtools
  show it with a generic view, agents read it with the command, and `topic` names the topic that
  says it changed. A panel with a view renders itself: while some session subscribes to
  `<id>.view.<panel>`, `view` gets an open `View` and each `view.send(batch)` goes to those
  sessions as `{"event":"<id>.view.<panel>","frame","format":1,"seq","reset","mutations":[...]}`;
  `fresh` (and `"reset": true` on the batch) means a session opened it since the last turn, so
  the whole view goes from nothing. The records a client sends back with `viewEvents` come out of
  `view.takeEvents`, with the view's own ids. Nobody subscribed: the view is told it is closed,
  and should cost nothing.

`hello` lists the extensions: `{"id","version","commands","topics","tools","panels"}`, names
without the id; a tool is `{"command","title","description","inputSchema","readOnly"}`, a panel
`{"id","title","data","topic","view"}` (`view` is its view topic, the others are there when it
has them). `mutationFormat` is the version of the batch format (`remote.silk`): mutations as
JSON objects with an `op`, styles as CSS text; root options, resources, canvases, grids,
anchors and virtual lists do not travel, so a remote view is drawn with the client's fonts,
images and look.

silk-ui's own extension, `silk-ui` (a program's messages and model, and its Program panel), is
in [ui-app-inspect](../../app/inspect); the window host registers and serves it as any framework
would.

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
- A hidden root beside the inbox, with a local session on an inspector that is off: hello,
  tree, query (within the root too), inspect and highlight leave its nodes out, its records are
  not logged, five changes and frames of it push nothing while a change to the app pushes
  `tree`, and the inspector is off again once the client closes its end.
- The MCP bridge over the same fixture (see [ui-inspect-mcp](../mcp/README.md#tests)).
- Style edits and the edit log (`edits.silk`): an edit outlasts the client restyling the node
  and a reset shows the value the client set meanwhile; edits coalesce, and leave the log when
  set back; one property is reset alone; comments with threads; resolve and reopen; an unknown id
  changes nothing; `since`; a destroyed node's edit is no longer applied; `seq` only grows; the
  `edits` topic goes out once a frame and not while nothing changes, nothing asks for frames
  once an edit is drawn, and the log outlives the session that made it (a one-shot client reads
  it too); an agent's round trip over MCP, its requests served by one-shot sessions over a
  memory channel (tools listed, edits read, a reply in a thread, resolved). In the hidden root
  test, an edit of the app's node leaves the hidden root's revision alone, and its nodes cannot
  be edited.
- Extensions, with a notes extension that belongs to no framework (`extensions.silk`): `hello`
  lists it and names its commands and topics in full; a command waits for the extension and its
  reply reaches the session that asked, a one-shot session too; unknown commands and prefixes;
  a data panel's command; a topic pushed once a frame, held for the next, and not at all when
  nothing changed; a view that renders only while open, from nothing when opened, whose batch
  replays into another tree and whose click comes back through `viewEvents`; the batch and event
  formats read back to the same text; MCP tools listed from `hello` and called, a call before
  the list learning them first.
- `demo inspect` (CI job `demo` in ui-inspect.yml): snapshot, click New by role and name, wait
  for the new row, highlight Archive, inspect it, screenshot to a PNG.

## Limits

- `wait` is answered `pending` and the client asks again (ui-inspect-cli does, every 50 ms),
  in a session too.
- A connection costs two pump threads, besides the one accept thread. Closing the inspector
  waits for them, up to a read pause (0.2 s).
- `type` sends `TextInput` records (Enter and Tab for newlines and tabs); IME preedit is not driven.
- The timeline keeps the last 240 frames.
- An extension is served on the app's thread when the app's loop serves it: its replies and
  views come a turn of the loop after the request, never on the spot (a client in the app's
  process sends such requests without waiting, `Link.ask` in the devtools).
- The event log keeps the last 500 records the app took (`Inspector.observe`); input the
  tree did not queue a record for (no node listens) is not in it. No session recording over
  the wire yet; sessions are still in memory
  (ui-inspect's `Session`).
- Screenshots come from the CPU renderer, not a GPU readback.
- The highlight has no name tag over the node.
- The edit log lives as long as the app: it is not saved anywhere, and an app started again
  starts with none. Edits have no source location.
- `edits` with `since` lists what changed after a seq, but not the entries that left the log
  (reverted or reset); read it whole to see those go.
