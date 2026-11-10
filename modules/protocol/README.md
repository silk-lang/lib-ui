# ui-protocol

The plain data a UI tree and its client exchange. Nothing here holds a tree, so a client can
build these values on one side of a wire and a host can read them on the other.

- `ui_protocol.lib`: the typed forms. `Mutation` and `Batch` going in with `Input`,
  `EventRecord` and `HostRequest` coming out, node handles (`NodeId`, `BoxNode`, ...), and
  `Propagation` for walking an event's path with capture, target and bubble phases.
- `ui_protocol.mutation`, `ui_protocol.batch`: every change a client can make, as plain data
  with client-chosen ids, and the builder that collects them.
- `ui_protocol.css`: the CSS vocabulary styles are written in (`css.width(px(100.0))`), from
  css-properties.
- `ui_protocol.grid`, `ui_protocol.options`: grid templates and the option structs mutations
  carry.
- `ui_protocol.input`, `ui_protocol.record`, `ui_protocol.request`: the flat forms that travel
  as they are.

The package depends only on data: css-properties, css-layout value types and the decoded image
struct. `ui-tree` re-exports all of it under its old names, so `ui_tree.lib` users change
nothing.
