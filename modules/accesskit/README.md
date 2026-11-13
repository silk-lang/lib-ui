# AccessKit for Silk

A port of [AccessKit](https://github.com/AccessKit/accesskit) to Silk. An application describes
its UI as an accessibility tree of [`Node`](src/node.silk)s and sends it to a platform adapter as
incremental [`TreeUpdate`](src/update.silk)s; the adapter answers screen reader queries from it and
hands their requests back as [`ActionRequest`](src/update.silk)s.

| Package | AccessKit crate | What it holds |
| --- | --- | --- |
| `accesskit` (this directory) | `accesskit` | The schema: nodes, roles, actions, geometry, updates |

More packages (the consumer tree and the macOS, Windows and Linux adapters) follow in this
directory.

Names follow Silk style: `set_label` is `setLabel`, `Node::new` is `Node.make`, and because `role`
is a Silk keyword, `role()` and `set_role` are `accessRole()` and `setAccessRole`. Associated
constants are functions: `TreeId.root()`, `Affine.identity()`, `Rect.zero()`.

## License

AccessKit is Copyright 2023 The AccessKit Authors (see [AUTHORS](AUTHORS)) and is licensed under
either of the [Apache License 2.0](LICENSE-APACHE) or the [MIT license](LICENSE-MIT), at your option.
This port keeps that license for the files here. Role and property descriptions derived from
Chromium are under the BSD license in [LICENSE.chromium](LICENSE.chromium).
