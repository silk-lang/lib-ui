# ui-inspect-cli

A command line client for the inspector protocol ([ui-inspect-server](../server)): it sends one
request to a running Silk UI and prints the answer.

```sh
silk build --manifest-path ui/inspect/cli/silk.toml
build/llvm/x86_64-unknown-linux-gnu/debug/ui-inspect-cli snapshot
```

```text
ui-inspect-cli [--connect ADDRESS] COMMAND [OPTIONS]

hello                          protocol version, viewport, node count
snapshot [--styles]            the tree as text (describe); with a target, that subtree
query                          the nodes a target matches (--limit N)
inspect                        the devtools-style view of the target node
pick X Y                       the node at a point, and the hit path
highlight [ID ...]             highlight nodes (or all target matches); none clears it
screenshot FILE                the frame as a PNG; with a target, that node alone
click | hover                  pointer input on the target (or --x X --y Y); click --count N
scroll [--dx N] [--dy N]       wheel input over the target (or --x/--y)
press KEY [--code CODE]        a key press (UI Events key value: Enter, Tab, a, ...)
type TEXT                      text input to the focused input (click a target first with --node etc.)
wait [--gone] [--timeout MS]   until the target exists (or is gone); default 5000 ms
stats                          the last frame's counters
raw JSON                       send a request as written

Targets: --node ID --role ROLE --name TEXT --label TEXT --text TEXT --test-id ID
         --within ID --exact --hidden
Input:   --modifiers shift,control,alt,meta
```

ADDRESS uses the syntax of `SILK_UI_INSPECT` (`1`, `tcp:<port>` or a socket path). Without
`--connect` the CLI reads `SILK_UI_INSPECT`, so the same variable serves the app and the CLI.
snapshot and inspect print their text, screenshot writes the file, the rest print the reply
line. Exit codes: 0 ok, 1 the command failed (the reason goes to stderr), 2 the app cannot be
reached or the arguments are wrong.

## Pointer/key phases and timed mosaics

```sh
ui-inspect-cli --connect /tmp/silk-ui.sock pointer --phase down --x 300 --y 120
ui-inspect-cli --connect /tmp/silk-ui.sock pointer --phase move --x 500 --y 180
ui-inspect-cli --connect /tmp/silk-ui.sock pointer --phase up --x 500 --y 180
ui-inspect-cli --connect /tmp/silk-ui.sock key ' ' --phase down --code Space
ui-inspect-cli --connect /tmp/silk-ui.sock key ' ' --phase up --code Space
ui-inspect-cli --connect /tmp/silk-ui.sock capture sequence.png \
  --count 10 --interval 100 --columns 5 --tile-width 480 --test-id canvas
```

`capture` uses the same implementation as MCP `ui_capture`. It saves one PNG mosaic and
prints actual sample times and source frames. Waits happen in the client; the app handles
input between screenshots. Repeated frame numbers remain visible. Omit `--test-id canvas`
to capture the whole window. These CPU captures help diagnose transitions and stalls; they
are not an FPS measurement. Capture limits and target semantics match the MCP tool.
