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

Results are text: the snapshot or node view text, otherwise the protocol's reply line. A failed
command (no node matches, a covered node, a timed out wait) is a tool result with `isError`, so
the agent sees the reason. Input waits for the app to draw its answer before the next call
answers, so a snapshot right after a click shows the result.

A typical agent session: `ui_snapshot` to read the tree, `ui_click` with `label: "New"` (or
`role: "button", name: "New"`), `ui_wait` for the change, `ui_screenshot` to look at it.

## How it works

`ui_inspect_server.mcp.Bridge` is the protocol work, with no I/O: a JSON-RPC message in, and
either a response to write or an inspector request to send. `ui-inspect-mcp` is the loop around
it: it reads standard input line by line, sends requests with `ui_inspect_server.client`, and
asks a pending `wait` again every 50 ms until its timeout (the inspector serves one request per
connection, so it cannot hold a request open across frames).

It implements MCP revision 2025-06-18 (and answers 2024-11-05, 2025-03-26 and 2025-11-25 clients
with their own revision): `initialize`, `ping`, `tools/list`, `tools/call`. Notifications are
accepted and ignored. Calls are answered one at a time, in order.

## Tests

```sh
silk test --manifest-path modules/inspect/server/tests/silk.toml --root src/tests.silk
node modules/tree/demo/scripts/demo mcp     # an MCP client drives the demo in a window
```

- `mcpToolsDriveTheTree`: the bridge over the inbox fixture, with `Protocol.handle` in place of
  the socket: initialize and version negotiation, notifications, tools/list, snapshot equals
  `describe`, inspect equals `inspectNode`, the New button found by its label and clicked (the
  app sees the click), a screenshot as a PNG image, wait holding and timing out after retries,
  tool errors, JSON-RPC errors, an unreachable app, and JSON written back by `writeValue`.
- `demo mcp` (CI job `demo` in ui-inspect.yml), the exit test for agent access: an MCP client
  starts `ui-inspect-mcp` over stdio, reads a snapshot, finds the button labelled New in it,
  clicks it by that label, waits for the new row, inspects and highlights Archive and takes a
  screenshot.

## Limits

- One tool call at a time; a long `ui_wait` holds the session until it ends.
- No MCP resources, prompts or progress notifications; cancellation is ignored.
- Whatever the inspector protocol does not do (event log, session recording, GPU readback, IME
  preedit) the tools do not do either.

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
