# ui-js

Runs a JavaScript application on a UI tree, with the [SilkJS](https://github.com/silk-lang/lib-silkjs)
engine embedded in the process. This is the first slice of the embedded runtime plan: the Silk
host and the raw bridge. The JavaScript packages (a node API, a React renderer, a Vite plugin)
build on it and are not here yet.

## How it works

JavaScript runs on the thread that owns the tree.

- **Nodes.** JavaScript calls native functions on the global `__ui` (`create`, `append`,
  `insertBefore`, `root`, `setText`, `listen`, `size`, `tabIndex`, `focus`). Each call appends a
  mutation to one ui-protocol batch and returns. `JsHost.flush` applies the batch to the tree.
- **Events.** `JsHost.input` runs one input: the tree queues its event records (`begin`), the
  host calls `__ui.dispatch(kind, target, x, y)` for each, the tree runs or skips the default
  action depending on whether a handler prevented it (`finish`), and the mutations the
  handlers made are flushed. `kind` is the bit position of the event in the ui-protocol
  `LISTEN_*` flags. Because handlers run before the default, `preventDefault()` works as it
  does on the web.
- **Errors.** An uncaught exception fails the call with a `JsError` that carries its message.
  The host stays usable.

```silk
let mut host = run JsHost.open(&memory, domain.handle())
run host.evaluate(source, b"app.js")
run host.flush(&mut tree)
run host.input(&mut tree, Input.press(10.0, 50.0))
run host.close()
```

Provide the `RuntimeAllocator` that `memory` observes as the `Allocator` of these calls.

## Status

- Tests: `silk test --manifest-path modules/js/tests/silk.toml --root src/tests.silk` from the
  repository root.
