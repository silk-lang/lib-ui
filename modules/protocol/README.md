# ui-protocol

The plain data a UI tree and its client exchange. Nothing here holds a tree, so a client can
build these values on one side of a wire and a host can read them on the other.

- `ui_protocol.lib`: the typed forms. `Input` going in, `EventRecord` and `HostRequest` coming
  out, node handles (`NodeId`, `BoxNode`, ...), and `Propagation` for walking an event's path
  with capture, target and bubble phases.
- `ui_protocol.input`, `ui_protocol.record`, `ui_protocol.request`: the flat forms that travel
  as they are.

`ui-tree` re-exports all of it under its old names, so `ui_tree.lib` users change nothing.
Mutations and batches still live in `ui-tree` and move here next.
