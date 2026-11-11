# Windows, inspector transports, custom panels, style edits

Status: steps 1–6 of the [order of work](#order-of-work) are implemented; the rest is a draft
for review.
Code sketches show shape only, not final names or syntax.

## Summary

1. **Roots.** The tree protocol learns about several root trees, opened and
   closed by mutations. A backend maps a root to whatever it has: an OS
   window, a host element, a named document, a headless surface.
2. **Inspector sessions and channels.** The inspector protocol becomes a
   long-lived session with pushed events, over a `Channel` service with
   in-memory and socket implementations.
3. **Extensions.** The inspector knows the tree and its windows, nothing else.
   A framework adds commands, topics and panels through one extension API.
   silk-ui is the first user of it, not a special case.
4. **Edits and tokens.** A persistent list of style edits and comments that
   agents read over MCP, and a two-way token file.

## Layers

| Layer | Packages | Knows about |
|---|---|---|
| Tree | `ui-protocol`, `ui-tree`, `ui-tree-window` | Nodes, styles, events, roots. Roots are opened imperatively. |
| Inspector | `ui-inspect`, `ui-inspect-server`, cli, mcp | The tree layer only: tree, roots, styles, events, input, highlight, pick, screenshots, frames, audit, edits. Plus the extension API. |
| Framework | `ui-app` (silk-ui), or any other | Model, messages, commands. Wraps roots however it likes. Registers its own inspector extension (silk-ui's is `ui-app-inspect`, so `ui-app` itself stays free of the inspector). |
| Devtools UI | `ui-inspect-devtools` | An inspector client. Built with silk-ui, which is an implementation choice and leaks nothing into the protocol. In the app's process it is a window-host companion (`ui-tree-window`), so it also needs that host. |

Two things in the code broke this until step 5:

- `ui-inspect-server` owned the program log: `program`, `messages`, `model`
  and the model diff lived in `modules/inspect/server/src/program.silk`, fed by
  `Inspector.program`. They are now the `silk-ui` extension, in
  `modules/app/inspect` (`ui-app-inspect`).
- Devtools had a hard-wired Program tab (`Panel` enum). It is now a panel
  silk-ui supplies as a remote view.

Frame timings stay in the inspector: the window host produces them.

## Where the code is today

| Area | Fact | Where |
|---|---|---|
| Root | One root per tree; `setRoot` detaches the previous one | `modules/tree/src/engine.silk:187`, `:1026` |
| Root | `ROOT_ID = 1`; `dispatch` drops events whose path starts at neither it nor a declared window's root node | `modules/app/src/ui.silk:75`, `runtime.silk` |
| Backend | `Backend` has `mutate`, `events`, `viewport`, `measure`, `range`, `navigate`; no root parameter | `modules/app/src/backend.silk:26` |
| Events | `Event.path` runs from the root node to the target; no window field | `modules/protocol/src/record.silk:33` |
| Native | The host runs one tree, with a window per open root | `modules/tree/window/src/host.silk` |
| Native | The platform thread is already keyed by `WindowId` | `modules/tree/window/src/platform_thread.silk:57` |
| DOM | One `Runtime` + one `Dom` per page; JS tracks one `rootId` | `modules/app/dom/src/page.silk:68` |
| Inspector | One JSON line in, one out, then close | `modules/inspect/server/README.md:73` |
| Inspector | Devtools polls every 0.5 s; each sync is 6–8 requests, each a new connection | `modules/inspect/devtools/src/devtools.silk:64`, `:452` |
| Inspector | The host loop wakes every 20 ms while the inspector is on | `modules/inspect/server/src/server.silk:366` |
| Inspector | `Protocol.handle` has no socket code; devtools already has a `Link` service with socket and in-process implementations | `protocol.silk:378`, `devtools/src/link.silk:8` |
| Inspector | Everything is typed against `UiTree`, not `Backend` | `protocol.silk:378` |
| Inspector | Hidden roots: left out of replies, queries, the event log and topics | `protocol.silk` (`Protocol.hide`) |
| Inspector | A session in the same process: `openLocal`, served on the spot by `serveLocal` | `server.silk` |
| Native | A companion beside the client: input, records and frames of its roots, every key first; its root in a window or docked in the first | `modules/tree/window/src/companion.silk` |
| Devtools | Run in the app's process as that companion, on a hidden root set aside in the tree | `modules/inspect/devtools/src/embedded.silk` |
| Inspector | Built-in commands are an if/else chain; `<id>.<command>` goes to the extension registry. The MCP tool list is the built-in array plus the tools of the extensions `hello` lists | `protocol.silk` (`execute`), `extension.silk`, `mcp.silk` |
| Inspector | Extensions: registered with `Inspector.extend`, served from the app's loop with `Inspector.serveExtension`; topics by name, views on `<id>.view.<panel>` | `modules/inspect/server/src/extension.silk` |
| Inspector | Mutation batches and event records as JSON, `mutationFormat` 1 | `modules/inspect/server/src/remote.silk` |
| Framework | silk-ui's extension: program log, `silk-ui.*` commands, the Program panel as a silk-ui program on a `ViewBackend` | `modules/app/inspect/src/{extension,program,panel}.silk` |
| Devtools | Tabs past their own come from `hello`; data panels in rows; views replayed by `ViewHost`, their records sent back | `modules/inspect/devtools/src/{devtools,remote}.silk` |
| Inspector | `highlight` exists; devtools only calls it on click | `protocol.silk:784`, `devtools.silk:1128` |
| Styles | `setStyle` lays an override over the node (`UiTree.setOverride`), kept until reset or resolved; each property is an edit in the app's edit log, with comments | `tree/src/engine.silk` (`StyleOverride`), `server/src/{tools,edits}.silk` |
| Theme | `Theme` is a struct passed by hand in ui-components; no variables in css | `modules/components/src/theme.silk:16` |
| std | `silk.toml` exists: parser, scanner with byte spans, comment-preserving formatter | `stdlib/silk/toml/` |
| std | `accept` returns an owned `Accepted`; the connection is reachable only inside `withAccepted`, which closes it on return | `stdlib/silk/net/socket_native.silk:2736`, `:2823` |
| std | No call-site intrinsic; no file watcher | intrinsic list of dev.67; `stdlib/silk/system/` |

The sluggishness is the polling: a click waits up to 0.5 s for the next tick,
then pays 6–8 connects.

## 1. Roots in the tree API

### Prior art

| Family | Examples | Window set | Trade-off |
|---|---|---|---|
| Imperative open, view indexed by id | [iced](https://docs.rs/iced/latest/iced/window/index.html), [GPUI](https://docs.rs/gpui/latest/gpui/struct.App.html), Dioxus, Slint | Command returns an id; app mirrors it in its model | Two sources of truth that can drift |
| Windows as a function of state | [Compose](https://kotlinlang.org/docs/multiplatform/compose-desktop-top-level-windows-management.html), [egui viewports](https://docs.rs/egui/latest/egui/viewport/index.html), Xilem, QML | Declared each render, diffed like children | Needs stable keys and a requested-vs-actual split for geometry |
| Static scene kinds, value-keyed instances | SwiftUI `WindowGroup` + `openWindow(id:value:)` | Kinds declared, instances opened | Dedup and restore for free; kinds are fixed |
| One heap per window + IPC | [Tauri](https://v2.tauri.app/develop/calling-frontend/), [Electron](https://www.electronjs.org/docs/latest/tutorial/message-ports), several Elm roots | Separate programs | Serialised, untyped, unordered events; state duplicated |

These are framework-level choices. All of them sit on a lower layer that
opens and closes surfaces imperatively; that lower layer is what the tree API
provides.

Useful details for the tree layer:

- **Compose**: its v2 API had to separate requested geometry from what the
  window manager applied.
- **egui**: on a backend with no windows a viewport degrades to an embedded
  in-canvas window.
- **Flutter web multi-view**: the host adds views bound to host elements; one
  engine serves all of them.

### Tree API

A root is a top-level tree with an id chosen by the client, like node ids.

```
Mutation.OpenRoot   { root: u32, node: u32, options: RootOptions }
Mutation.UpdateRoot { root: u32, options: RootOptions }
Mutation.CloseRoot  { root: u32 }

RootEvent { root, kind: CloseRequested | Resized | Focused | Blurred
                        | ScaleChanged | AppearanceChanged | Failed }
```

- `RootOptions`: title, requested size and position, resizable, parent root,
  kind (window, panel, embedded).
- Options are requests. What the system applied comes back as root events.
- The tree never closes a root on its own. `CloseRequested` is an event; the
  client answers with `CloseRoot` or not at all.
- Node ids stay in one id space, so a client's diffing is unchanged.
- Element events need no new field: `path[0]` is the root's node. Only root
  events carry `root`.
- `Backend.viewport` takes a root. `Backend` gains a capability query: how
  many roots it can show and what an extra root becomes.
- In the engine, `root`, `focused`, viewport and scene move into a per-root
  record. Glyph atlas and fonts stay shared.
- Window calls that are not tree state (minimise, full screen, file dialogs)
  stay host requests and take a root.

**What a root becomes per backend**

| Backend | First root | Extra roots |
|---|---|---|
| Native window | OS window | OS window, one render surface each |
| Window host in wasm | The canvas | A canvas per root |
| DOM | `mount({root})` element | Decided by the host page; see decision 6 |
| SSR / static | The page | Rendered only when asked for |
| Headless harness | Default target | Selected by root id |
| Inspector | — | `tree` lists roots; commands accept a root |

### What a framework does with it

Not part of the tree API. A framework may open roots from commands, declare
them from state, or both.

For silk-ui the plan is declarative: an optional `windows(model, w)` next to
`view`, keyed by a program-chosen key, diffed into `OpenRoot` / `UpdateRoot` /
`CloseRoot`. `CloseRequested` becomes a message and the model decides. One
model serves every root, so windows share state with no wire protocol. A
second program in the same process gives isolation; the two talk through
ports and `Poster`.

### Risks

- Per-window render threads and surfaces in the native host are the largest
  piece of work.
- Focus becomes per root, with one key root.
- Restoring window positions across launches is out of scope.

## 2. Inspector sessions and channels

### Prior art

| System | Transport | Flow | Versioning |
|---|---|---|---|
| [React DevTools](https://github.com/facebook/react/blob/main/packages/react-devtools/OVERVIEW.md) | `Wall { listen, send }`; same code over postMessage, websocket, inline | Tree pushed as patch operations; props pulled for the selection | Protocol number exchanged at connect |
| [CDP](https://github.com/ChromeDevTools/devtools-protocol/blob/master/pdl/domains/Overlay.pdl) | Websocket or pipe | `{id, method}` requests; messages without `id` are events, sent after `X.enable` | Stable vs experimental |
| [Dart VM Service](https://github.com/dart-lang/sdk/blob/main/runtime/vm/service/service.md) | JSON-RPC over websocket | `streamListen` then notifications | Semver; ignore unknown events |
| [LSP](https://microsoft.github.io/language-server-protocol/specifications/lsp/3.17/specification/) / DAP | Any byte stream | Requests, notifications, progress | Capabilities; a missing one means absent |

Hover in Chrome is one small command (`Overlay.highlightNode`); the app side
draws. Our overlay already works that way.

### Proposal

**Protocol 3: a session.** Still JSON lines.

```
→ {"id":1,"cmd":"hello","client":"devtools","wants":["tree","events","pick"]}
← {"id":1,"ok":true,"protocol":3,"capabilities":{...},"extensions":[...],"roots":[...]}
← {"event":"tree","patch":[...]}
→ {"cmd":"highlight","nodes":[41]}          // no id, no reply
```

- A request with an `id` gets a reply. A message without one is a notification
  in either direction.
- The client subscribes to topics; the app pushes tree patches, events,
  frames, pick results and edits as they happen. No polling.
- Capabilities replace the hard-coded command list. Unknown events are ignored.
- A session that sends one request and closes still works, so the CLI stays
  simple.

**`Channel` service, app side.** `Protocol.handle` stays transport-free; the
listener moves out of `Inspector`.

```silk
pub service Channel {
  effect fn receive(line: &mut String) -> bool   // non-blocking
  effect fn send(line: string) -> bool
}
```

| Implementation | Use |
|---|---|
| `MemoryChannel` | Embedded devtools in the same process; tests |
| `SocketChannel` | Devtools in another process, CLI, MCP |
| Later: websocket, stdio | Inspecting a DOM program; agent launchers |

Devtools' existing `Link` becomes the client end of the same pair.

**Embedded and windowed devtools**

| Mode | How |
|---|---|
| Docked in the app window | Devtools root drawn over the bottom of the app's window; the app's root is laid out in the rest, as its whole window |
| Own window, same process | Devtools root as an extra root, `MemoryChannel` |
| Own process | Today's app, `SocketChannel` |

The two same-process modes are one window-host companion (`embedded.silk`): the devtools'
silk-ui runtime placed in a root and an id range of its own (`Runtime.placeAt`, ids from
`0xF0000000`), the root set aside in the tree (`UiTree.setAside`) so the app never hears of
its records, and hidden from the inspector (`Protocol.hide`) so the devtools never inspect
themselves. A docked root is laid out at the window's size with its content in the dock; the
host draws its scene over the app's. Each root counts its own revision (`UiTree.revisionOf`),
so the devtools drawing is no `tree` news. `SILK_UI_DEVTOOLS=window|dock|1` opens them, F12
toggles them. ui-app-window runs every silk-ui app with them; a tree client calls
`host.runWindowWith` with them.

**Inspecting other backends.** `Protocol` takes `UiTree`. To inspect a DOM
program it needs a small interface (tree snapshot, box, styles, highlight) that
`UiTree` implements first. Not needed for the first steps.

**Snappiness.** Selection and hover update devtools state locally at once, then
send a notification. Row hover sends `highlight`; leaving clears it. The
overlay shows size and font next to the box.

### Risks

- Pushing tree patches means the inspector sees every mutation batch; it must
  cost nothing when no client is subscribed.

## 3. Extensions and panels

### Prior art

| Family | Examples | Trade-off |
|---|---|---|
| A. Data schema rendered by devtools | Vue inspector API, [Vite DevTools `json-render`](https://devtools.vite.dev/kit/dock-system), Chrome sidebar `setObject` | Works over any transport, readable by agents; limited to host widgets |
| B. UI tree supplied by the app, rendered remotely | `json-render` is the nearest | Authors use their own view language; needs a serialisable tree and events routed back |
| C. Code running inside devtools | Storybook, TanStack, [Flutter DevTools extensions](https://pub.dev/packages/devtools_extensions) (iframe) | Most power; separate build, version skew, opaque to agents |

For protocol extension: CDP groups commands and events into domains; the Dart
VM Service lets an app register RPCs (`registerExtension`) and post events on
an extension stream.

### Proposal

One registration, at the inspector layer, with no framework types in it.

```silk
inspector.extend(Extension {
  id: "silk-ui",
  commands: [ "messages", "model", "subscriptions" ],   // served as silk-ui.messages, …
  topics:   [ "message" ],                              // pushed as silk-ui.message
  tools:    [ ... ],                                    // MCP descriptions for the commands
  panels:   [ Panel { id: "program", title: "Program", data, view } ],
})
```

- `hello` lists extensions with their commands, topics and panels. Devtools
  builds its tab bar from it; the MCP bridge builds its tool list from it.
- Commands and topics are namespaced by extension id.
- A panel has two faces:
  - `data`: JSON, shown with a generic tree/table view and readable by agents.
  - `view`: a root whose backend is the channel. The app sends ordinary
    `Mutation` batches on a panel topic; devtools replays them into a subtree
    with remapped ids and sends events back.
- The view is tree protocol, so any framework that drives a tree can supply
  one. silk-ui writes its panel with `Document`; another framework uses its
  own builder.

silk-ui's Program tab, message list and model diff move into this extension
in `ui-app`. Router, store or user panels register the same way.

### As built (step 5)

Silk has no dynamic dispatch, so the inspector cannot hold the extension
object. Registration is data and serving is the app's:

```silk
let mut info = run Extension.make("silk-ui", "0.1.0")
run info.command("messages")                    // served as silk-ui.messages
run info.topic("message")                       // pushed as silk-ui.message
run info.tool("messages", "Message log", "...", schemaJson, true)
run info.panel("program", "Program", "program", "message", true)  // data, topic, view
run inspector.extend(move info)
// on every turn of the app's loop, while the inspector is on:
run inspector.serveExtension("silk-ui", &mut silkUi)   // silkUi: an ExtensionHandler
```

- `ExtensionHandler` has `command(name, request, out) -> bool`,
  `topics(news)` and `view(panel, view)`. A command is queued by the
  inspector and answered when the app next serves the extension; the reply
  goes to the session that asked (`Session.deliver`), and `pollInterval` is 0
  while something waits.
- Topics are kept by name next to the built-in bitmask; each is pushed at most
  once a frame, as the built-in ones, and dropped when nobody listens.
- A panel's view is open while some session subscribes to its view topic
  `<id>.view.<panel>`. `View.send(batch)` pushes
  `{"event", "frame", "format", "seq", "reset", "mutations"}`; events come back
  with the built-in `viewEvents` command and out of `View.takeEvents`.
- Devtools send extension requests with `Link.ask`, whose reply comes with
  the notifications: a client in the app's own process cannot wait for the
  app's next turn. The window content's `intercept` hook takes a replayed
  view's records before the devtools' program sees them.
- silk-ui's extension lives in a new package, `ui-app-inspect`, which
  `ui-app-window` registers and serves; `ui-app` stays inspector-free.

### Risks

- Remote views tie panels to the `Mutation` format, so that format needs a
  version in `hello`.
- Fonts, images and theme of a remote view come from devtools, not the app.

## 4. Style edits, comments, tokens

### Prior art

- **Chrome / Firefox Changes**: before/after per property is the unit of
  review. Both lose edits on reload.
- **[Chrome Workspaces](https://developer.chrome.com/docs/devtools/workspaces)**:
  the dev server declares a project root; CSS values are saved, structure is
  not.
- **[Agentation](https://www.agentation.com/schema)**: each annotation carries
  a comment, element path, source location, status, a thread and a monotonic
  sequence. Agents read it over MCP.
- **Lovable, Onlook**: deterministic source rewrites, which need a build-time
  source id per element.
- **[DTCG 2025.10](https://www.designtokens.org/tr/2025.10/format/)**: typed
  tokens, aliases, themes through a resolver. JSON only. No TOML precedent
  beyond editor themes such as Helix's `theme.toml`.

### Proposal

All of this is tree-level and lives in the inspector.

**Overrides that survive a mutation.** Edits move from "mutate the tree once"
to an override layer in the inspector, reapplied when the client restyles the
node, until reset. Without this an edit disappears on the next update.

**Edit log, kept in the app** so it outlives a devtools reconnect.

```
Edit    { id, seq, target { root, path, key?, source? }, property,
          before, after, origin: inline | token, status }
Comment { id, seq, target, text, status, thread }
```

Protocol and MCP: `edits`, `comment`, `resolve`. Pushed as an `edits` topic.
An agent reads the list, changes the code, and marks entries resolved. Devtools
never rewrites source.

**Editor.** A design sidebar for the common properties (layout, fill, border,
radius, text) and the declaration list as fallback. Autocomplete comes from
the css package's own property and value tables; arrows step numbers.

**Tokens.** The one place devtools writes a file. See decision 4.

### As built (step 6)

**The override layer is in the tree**, as a generic hook with no inspector type in it:

```silk
pub struct StyleOverride { id: u32, state: StyleState, declarations: List<Declaration>, replace: bool }
run tree.setOverride(id, state, declarations, replace)   // false: no such node
tree.clearOverride(id, state)                            // the client's declarations show again
tree.overrideOf(id, state); tree.overridden(id, state); tree.styleOverrides()
```

- The tree keeps a short list of overrides. When it resolves a node's style in a state that
  has one, it merges the override over a copy of the client's declarations (`css.set`, so
  shorthands and `em` lengths behave as in one patch), or uses it alone with `replace`.
- Nothing is reapplied, so nothing can loop: the client's `SetStyle` and `ClearStyle` change
  its own declarations underneath, which the tree never touches, and clearing the override
  shows exactly what the client set last, also while it was overridden. The client is never
  told (no mutation, no record; `NodeView.style` is the client's).
- Setting or clearing an override restyles only the root that holds the node
  (`touchRoot`: its revision moves, it needs a frame); hidden and other roots are untouched.
  Drawn once, an override costs no frame.
- `destroy` drops the node's overrides, so a node made later with its id has none.
- Cost when empty: one length check per resolved node; hover and press check `overridden`
  only when the list is not empty (a node with a hover override restyles on hover like one
  with a client hover style).
- The inspector keeps no copy of the client's declarations: what it needs (`before`) it reads
  when it records an edit.

**The edit log** (`modules/inspect/server/src/edits.silk`) lives in `Protocol`, so it lasts as
long as the app, whatever sessions come and go:

```text
Edit    {"id","seq","kind":"edit","status","target","state","property","before","after","origin","applied"}
Comment {"id","seq","kind":"comment","status","target","text","author","thread":[{"seq","text","author"}]}
target  {"root","node","path":[ids],"element":{node},"named":{node,"label"},"keys":[{"id","testId"}]}
```

- One `id` sequence for both kinds; `seq` is the log's change counter (every add, change,
  status change or removal moves it) and an entry's `seq` the last one that touched it.
- Statuses: `open`, `resolved`. An edit is one property of one node in one state; `state` is
  outside `target`. `before` is the client's value when the edit was made, null when the client
  set none (a covering shorthand does not count); `after` is the latest value, null when a
  `replace` leaves the client's out. Editing the property again changes `after`; setting it to
  what the client shows removes the edit and its declaration from the override. `applied` is
  false once the node was destroyed. `origin` is `inline`; `token` is defined for step 7 and
  never produced.
- `target` is written when the entry is made: the root, the id path from the root's node, the
  node object, the nearest node at or above it with a test id, label or accessible name (with
  its label), and the test ids along the path as `keys` (the tree has no other keys). No
  `source` (decision 5).
- **Resolve** marks an entry done. For an edit it means "the code now does this": its
  declaration leaves the node's override, so the node shows what the client sets, the new
  code's value once the app runs it (until then, the old one). **Reopen** (`resolve` with
  `reopen`) lays the edit's `after` over its node again, when the node is there and no newer
  edit of the property is open.
- **Reset** (`resetStyles`) takes edits back: all, or a target's, in one state, or one
  property. The open edits it undoes leave the log; resolved entries and comments stay.

**Protocol.** `edits` (`status`, `kind`, `since` → `seq`, `open`, `edits`, `comments`),
`comment` (target or none, `text`, `author`, or `reply` with a comment's id → `entry`),
`resolve` (`entry` or `entries`, `reopen` → `entries`); `setStyle` answers the node's open edit
ids and `seq`, `resetStyles` takes a target, `state` and `property` and answers `removed`,
`styles` adds `overrides`, `client` and `replacing` for edited states. The `edits` topic
(`{"event":"edits","frame","seq","open"}`) goes out at most once a frame when `seq` moved. All
are in `hello`; one-shot clients use them as any command. Ids are `entry`/`entries` because a
request's `id` is its reply's.

**MCP and CLI.** `ui_edits`, `ui_comment`, `ui_resolve` (and `ui_reset_styles` with a target,
state and property), described for the workflow: read the open edits and comments, find the
code by the named element and test ids, change it, resolve. The CLI has `edits` (printed for
people), `comment TEXT` and `resolve ID...`.

**Devtools.** A Changes tab (with the open count) lists the log by node: each edit's
property, before struck through and after, its state, whether it is no longer applied; each
comment with its thread; Resolve, Reopen and Reset per entry, Reset all. The Styles panel
edits through the layer and shows each edit as a `style <state> edited` section, striking the
client's declarations it hides; it takes a comment on the selected node. Of the Editor
paragraph: completion of property names from the css package's catalog and of values (the
property's initial value and the CSS-wide keywords: the package has no per-property keyword
table), and ArrowUp and ArrowDown stepping the last number (Shift 10, Alt 0.1), applied at
once. The design sidebar came with the visual redesign: the inspector's Design segment has
fields for the common properties, read from the computed style and written as declarations
through the same layer, so each lands in the log; the Changes tab became the inspector's
Edits segment, and the Styles panel its Declarations segment.

**Deviations.** The layer is in `ui-tree` rather than the inspector, as the cleanest seam: the
tree resolves styles, and anything that reapplied on restyle would have had to intercept the
client's mutations. `key` is `keys`, the test ids along the path. Statuses are two; a gone
node is `applied: false` rather than a status. `edits` with `since` does not report entries
that left the log. To show an edit outlasting a client restyle in the native checks, the tree
demo restyles Archive when New adds a row.

### Risks

- Tokens are a new concept in css and the engine. Largest item in this
  section.

## Order of work

| Step | What | Unblocks |
|---|---|---|
| 1 | Roots in protocol and engine; existing programs unchanged | 3, 4, 5 |
| 2 | Protocol 3 sessions, `Channel` with memory and socket, pushed topics, hover highlight | Snappy devtools; 4, 5, 6 |
| 3 | Native host with several windows; `windows` in silk-ui | Multi-window apps |
| 4 | Embedded and same-process windowed devtools (done) | — |
| 5 | Extension API; move the program log out of the inspector into `ui-app`; panels with data, then remote views (done) | Framework tabs |
| 6 | Override layer, edit log, comments, MCP tools (done) | Agent workflow |
| 7 | Tokens, TOML file, two-way editing | Theme editing |

The Paper redesign (instrument black and amber, Geist and Geist Mono, three columns) is
built: `theme.silk` and `design.silk` in the devtools, the Program panel in `panel.silk`, the
highlight in `ui-inspect`'s overlay. DOM multi-root and
inspecting DOM programs follow step 3 and are not scheduled here.

## Decisions

### Settled

**Declarative or imperative windows.** Not a tree question. The tree API is
imperative (`OpenRoot` / `CloseRoot` and root events). Each framework wraps
it; silk-ui's wrapper is described in section 1.

### 1. Keep `SetRoot`, or replace it

**Recommendation: replace it.** One way to make a root is easier to keep
correct in four backends than two.

- `SetRoot { id }` becomes `OpenRoot { root: 0, node: id, options: default }`.
- The typed wrapper keeps `tree.setRoot(node)` as a one-line helper, so
  callers and tests do not change.
- Touched: `UiTree.setRoot`, `Dom`, `Html`, `silk-ui-dom.js`, `Runtime.start`.
- The resulting tree is identical, so goldens should not move. That is the
  acceptance test for step 1.
- The old `App`/`Ui` path keeps calling the helper and stays single-root.

The alternative, keeping both, leaves a second code path that every new
backend must implement and that only old code exercises.

### 2. Persistent inspector connections

**Recommendation: a thread per session, no std change.**

std gives an owned `Accepted`, but the connection can only be used inside
`withAccepted`, which closes it when the callback returns. So a session has to
live inside one callback.

- The accept loop and each session run on worker threads. A session's callback
  loops: read a line, push it on an inbound queue; drain an outbound queue.
- The UI thread only touches the two queues. That queue pair is exactly
  `MemoryChannel`, so `SocketChannel` is `MemoryChannel` plus a pump thread
  and there is one code path to test.
- An arriving line wakes the UI loop the way `Poster` does. This removes the
  20 ms wake-up the host does today while the inspector is on.
- Cost: one thread per connected client, of which there are one to three.
- To check before starting: that a `Connection` read takes a deadline, so the
  pump can flush outbound lines while idle. If not, the session uses two
  threads.

The alternative is a std addition that turns `Accepted` into an owned
connection with non-blocking reads, which lets one thread serve every session.
std already does this for websockets (`acceptOwned`). Worth asking for later;
not worth blocking on.

wasm has no sockets: `MemoryChannel` only, until a websocket channel exists.

### 3. Panels: data first, or remote views

**Recommendation: both, in that order, inside step 5; and do not ship step 5
until the remote view works.**

- Data and commands are the registration and discovery mechanism, and all an
  agent needs. They come first because remote views build on them.
- Remote views are needed at once, because the Program tab moves out of
  devtools. A message list with a model diff is not a generic table.
- Order inside the step:
  1. Extension registry, namespaced commands and topics, `hello` listing, MCP
     tools generated from it.
  2. Move `program.silk` to `ui-app` as the `silk-ui` extension. Devtools
     keeps its current Program tab for now, shown only when the extension is
     present.
  3. Remote view replay in devtools. silk-ui supplies the Program panel as a
     view; the hard-wired tab is deleted.
- After 3, devtools contains no silk-ui knowledge, which is the test that the
  extension API is sufficient for any framework.

Done as recommended. Deviations: the program log went to a new package beside
`ui-app` (`ui-app-inspect`) rather than into `ui-app` itself; there is no
`silk-ui.frames` (frame timings stay the inspector's `frames`, as the window
host produces them) and no `silk-ui.subscriptions` (they are in
`silk-ui.program`); the devtools' own tabs (Styles to Stats) stay theirs, and
only extension panels come from `hello`; MCP tools are named
`<id>_<command>`, since MCP names allow no dots. A remote view carries no root
options, resources, canvases, grids, anchors or virtual lists in format 1.

### 4. Token file format

**Recommendation: TOML in our own shape, DTCG semantics, JSON export later.**

- TOML because it takes comments and you want to edit it by hand; DTCG is JSON
  only.
- Keep DTCG's rules so an export is mechanical: every token has a type, the
  type is never guessed, aliases are explicit.
- The type comes from the top-level table: `[color]`, `[size]`, `[radius]`,
  `[font]`, `[duration]`, `[shadow]`.
- An alias is a string in braces. A theme overrides existing keys only.

```toml
[color]
accent  = "#3B6EF5"
surface = "#FFFFFF"
focus   = "{color.accent}"

[radius]
control = 8

[theme.dark.color]
surface = "#0E0E10"
```

- **Reading.** `silk.toml` in std.
- **Writing.** The scanner reports byte spans. A value edit replaces the bytes
  of one scalar and nothing else, so comments, order and spacing are untouched
  by construction. No new writer is needed. Adding or renaming a token is not
  offered.
- **Safety.** Hash the file at read; before writing, re-read and compare; on a
  mismatch reload and reapply the one edit. Write to a temp file and rename.
- **Watching.** std has no file watcher. Check the modification time about
  once a second while the inspector is on.
- **Aliases.** Editing a value that is an alias asks whether to edit the token
  it points to or replace the alias with a literal.
- **Scope.** The program declares the token file. Devtools writes nowhere else,
  and only on an explicit action from the edits list.
- **In the tree.** Styles carry a token reference; the engine resolves it, so
  a token change restyles without a client update and the inspector can show
  the name.

### 5. Source locations on edits

**Recommendation: do not block on it; make `source` optional and add it when
the compiler can supply it.**

- std has no call-site intrinsic today. `reflectTypeName` exists.
- Without one, a target is: root, node path, keys along the path, and the
  nearest element with a name or label. An agent can search the code for a key
  or label, which is usually enough for a style change.
- With a caller-location intrinsic, a builder call can record
  `file:line:col` in debug builds, and the edit carries it. That is what makes
  tools like Agentation and React Grab precise.
- This is a compiler change and yours to schedule. The edit record does not
  change shape when it lands.

As built in step 6: `source` is absent from every target; the rest of the target is as above,
with the test ids along the path as its keys.

### 6. Extra roots on the DOM backend

**Recommendation: the host page decides; with no answer the root is not shown
and the client gets `Failed`.**

```js
mount({ wasm, root: main, roots: (id, options) => element | "popup" | null })
```

- An element: the root renders there, as in Flutter's multi-view.
- `"popup"`: `window.open` in the same heap, with the tree's styles copied
  into the new document. Opt-in, because browsers block popups that are not
  opened from a user gesture.
- `null` or no callback: `Failed`, and the framework decides what to show
  instead.
- SSR renders the first root; another root is rendered when asked for by id.
