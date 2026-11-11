# ui-inspect-mcp

A [Model Context Protocol](https://modelcontextprotocol.io) server for a running Silk UI, so
Claude and other agents can snapshot it, inspect nodes like devtools, and drive it with input.
It speaks MCP over stdio and talks to the app through the inspector protocol
([ui-inspect-server](../server)), the same one [ui-inspect-cli](../cli) uses.

```sh
silk build --manifest-path modules/inspect/mcp/silk.toml
build/llvm/x86_64-unknown-linux-gnu/debug/ui-inspect-mcp [--connect ADDRESS]
```

## Setup

The app must serve the inspector: a debug build, started with `SILK_UI_INSPECT` set (see the
[server README](../server/README.md#turning-it-on)). The MCP server finds it the same way the
CLI does: `--connect ADDRESS`, else `SILK_UI_INSPECT`, else `1` (the socket
`silk-ui-inspect.sock` in the working directory; TCP port 7357 on Windows). The app does not have
to be running when the server starts, since every tool call connects anew. A call made while the
app is down is a tool error that says where the server looked.

Claude Code, from the repository root:

```sh
claude mcp add silk-ui -- "$PWD/build/llvm/x86_64-unknown-linux-gnu/debug/ui-inspect-mcp" \
  --connect "$PWD/silk-ui-inspect.sock"
SILK_UI_INSPECT="$PWD/silk-ui-inspect.sock" ui-tree-demo &   # or any app serving the inspector
```

Other clients take the same command in their MCP configuration:

```json
{
  "mcpServers": {
    "silk-ui": {
      "command": "/path/to/ui-inspect-mcp",
      "args": ["--connect", "/path/to/silk-ui-inspect.sock"]
    }
  }
}
```

## Tools

Each tool is an inspector command (see the [protocol table](../server/README.md#protocol)), and
its arguments are that command's request members, passed through unchanged. Tools that pick a
node take a target: `node` (the `#id` in a snapshot), `role`, `name`, `label`, `text`, `testId`,
`within`, `exact`, `hidden`. Text matches are trimmed, case-insensitive substrings and the first
match in tree order wins.

| Tool | Command | Result |
| --- | --- | --- |
| `ui_status` | `hello` | protocol version, viewport, scale, frame, node count |
| `ui_snapshot` | `snapshot` | the tree as text (`describe`), one line per node; with a target, that subtree; `styles` adds style detail |
| `ui_query` | `query` | the matching nodes as JSON (id, kind, role, name, rect, focus, hover) |
| `ui_inspect` | `inspect` | the devtools-style node view as text |
| `ui_pick` | `pick` | the node at `x`, `y` and the hit path |
| `ui_highlight` | `highlight` | box model overlay on `nodes` or the target matches; neither clears it |
| `ui_screenshot` | `screenshot` | the frame (or one node, cropped) as **image content** (PNG) |
| `ui_capture` | repeated `screenshot` | one PNG mosaic; `count` (default 10), `intervalMs` (100), `columns` (up to 6), `tileWidth` (480), optional target |
| `ui_pointer` | `pointer` | individual `down` / `move` / `up`; supports drags through normal pointer capture |
| `ui_key` | `key` | individual key `down` / `up`, including held Space and repeat |
| `ui_click` | `click` | clicks the target (or `x`, `y`); `count`, `modifiers` |
| `ui_hover` | `hover` | moves the pointer over the target |
| `ui_scroll` | `scroll` | wheel input over the target; `dx`, `dy` |
| `ui_press` | `press` | a key press: `key` (UI Events value), `code`, `times`, `modifiers` |
| `ui_type` | `type` | types `text` into the focused input, or into `query` after clicking it |
| `ui_wait` | `wait` | until the target exists (or, with `gone`, does not); `timeout` in ms, default 5000 |
| `ui_stats` | `stats` | the last frame's counters |
| `ui_events` | `events` | the event records the app took (click, keydown, input, ...), with `since` and `limit` |
| `ui_frames` | `frames` | layout and paint time per frame, with the frame's counters |
| `ui_styles` | `styles` | the target's style patches per state |
| `ui_set_style` | `setStyle` | lays `style` declarations over the target for `state` (they outlast the app restyling it); `replace` leaves the app's out; each property becomes an edit in `ui_edits` |
| `ui_reset_styles` | `resetStyles` | takes style edits back: all, or the target's (one `state`, one `property`); their open edits leave the log |
| `ui_edits` | `edits` | the style edits and comments people made, for the agent to carry into the code: `status` (`open` for the work left), `kind`, `since` |
| `ui_comment` | `comment` | a comment on the target (or the app), or with `reply` an answer in a comment's thread |
| `ui_resolve` | `resolve` | marks `entries` (or `entry`) done once the code does what they ask; `reopen` opens them again |
| `ui_pick_mode` | `pickMode` | lets the person point at a node in the app's window; ask again for `picked` |
| `ui_audit` | `audit` | accessibility issues: unnamed controls, missing roles, unreachable or small targets, low contrast |

After these come the tools of the app's extensions (see
[Extensions](../server/README.md#extensions)): `tools/list` asks the app for `hello` and lists a
tool for each command an extension has, named `<id>_<command>` (characters MCP does not allow in
a name become `_`: `silk-ui.messages` is `silk_ui_messages`), described as the extension
describes it, or generically when it does not. A call to a tool the bridge has not listed yet
asks `hello` first. When the app is not running, `tools/list` has the inspector's tools alone.
A silk-ui app has `silk_ui_program`, `silk_ui_messages` and `silk_ui_model` this way.

Results are text: the snapshot or node view text, otherwise the protocol's reply line. A failed
command (no node matches, a covered node, a timed out wait) is a tool result with `isError`, so
the agent sees the reason. Input waits for the app to draw its answer before the next call
answers, so a snapshot right after a click shows the result.

A typical agent session: `ui_snapshot` to read the tree, `ui_click` with `label: "New"` (or
`role: "button", name: "New"`), `ui_wait` for the change, `ui_screenshot` to look at it. To
find why the app did something, read what its framework's tools say (for a silk-ui program,
`silk_ui_messages` and `silk_ui_model`: which message changed which field); to try a fix, `ui_set_style` and a screenshot; before finishing, `ui_audit`.

Design changes made in devtools come to an agent through the edit log. `ui_edits` with
`status: "open"` lists the style edits (one property of one node in one state: `before`, the
app's value, and `after`, the value wanted) and comments, each with a `target` that says which
node: its id path, the element (role, accessible name, test id) and the nearest named element
with its label and test id, and the test ids along the path. There is no source location yet,
so the agent searches the code for the named element's test id, label or text and changes the
code that styles it. Then `ui_resolve` with the ids: a resolved edit stops being laid over the
app, so the node shows what the app's code sets, which is the agent's change once the app is
rebuilt and run. `ui_comment` with `reply` answers in a comment's thread.

## How it works

`ui_inspect_server.mcp.Bridge` is the protocol work, with no I/O: a JSON-RPC message in, and
either a response to write or an inspector request to send. `ui-inspect-mcp` is the loop around
it: it reads standard input line by line, sends requests with `ui_inspect_server.client`, and
asks a pending `wait` again every 50 ms until its timeout. Each request goes on a fresh
connection, which the inspector answers once (protocol 2 style); a `wait` is answered `pending`
rather than held open across frames.

It implements MCP revision 2025-06-18 (and answers 2024-11-05, 2025-03-26 and 2025-11-25 clients
with their own revision): `initialize`, `ping`, `tools/list`, `tools/call`. Notifications are
accepted and ignored. Calls are answered one at a time, in order.

## Tests

```sh
silk test --manifest-path modules/inspect/server/tests/silk.toml --root src/tests.silk
silk task native mcp       # an MCP client drives the demo in a window
```

- `mcpToolsDriveTheTree`: the bridge over the inbox fixture, with `Protocol.handle` in place of
  the socket: initialize and version negotiation, notifications, tools/list, snapshot equals
  `describe`, inspect equals `inspectNode`, the New button found by its label and clicked (the
  app sees the click), a screenshot as a PNG image, wait holding and timing out after retries,
  tool errors, JSON-RPC errors, an unreachable app, and JSON written back by `writeValue`.
- `mcpToolsComeFromHello`: an extension of no framework's commands listed as tools after the
  inspector's, named as MCP allows, and called through the extension; a call before any list
  learns them first.
- `anAgentResolvesEditsOverMcp` (`edits.silk`): the edit tools are listed and described for
  the workflow; with an edit and a comment made as devtools make them, the agent reads the open
  ones and the named element, answers the comment, resolves both, and nothing is left open; each
  bridge request is served by a one-shot session over a memory channel.
- `demo mcp` (CI job `demo` in ui-inspect.yml), the exit test for agent access: an MCP client
  starts `ui-inspect-mcp` over stdio, reads a snapshot, finds the button labelled New in it,
  clicks it by that label, waits for the new row, inspects and highlights Archive and takes a
  screenshot; then sets a style on Archive, clicks New (the demo restyles Archive), reads the
  edit still applied with `ui_edits`, resolves it, and finds nothing left open.

## Limits

- One tool call at a time; a long `ui_wait` holds the session until it ends.
- No MCP resources, prompts or progress notifications; cancellation is ignored.
- Whatever the inspector protocol does not do (session recording, time travel, GPU readback,
  IME preedit) the tools do not do either.

## Capturing a sequence

Call `ui_capture` with `{"count":10,"intervalMs":100,"testId":"canvas"}` to receive an
image contact sheet of ten canvas captures. Leave out the target to capture the whole app.
Cells run left to right, then top to bottom. Captions show sample number, actual elapsed
milliseconds and source frame (`f`). The text result includes the same timing metadata.

Capture is bounded to 24 cells, widths 160–800 pixels, at most 6 columns and intervals
16–60,000 ms. Thumbnails preserve aspect ratio, with at most 600 pixels of image height.
Rendering/transport time may exceed the requested interval; samples are never fabricated or
relabelled to hide it. CPU reference screenshots are diagnostic images, not a GPU benchmark.

The client performs the waits. Other inspector clients and real user input can operate
between samples. For a scripted gesture, use a second client to send `ui_pointer` down,
moves and up while capture runs. Explicit `modifiers` apply to each event.
