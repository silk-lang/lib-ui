# ui-js

Runs a JavaScript application on a UI tree, with the [SilkJS](https://github.com/silk-lang/lib-silkjs)
engine embedded in the process. Two parts are here: the Silk host with its native bridge, and
`@silk/ui`, the JavaScript package applications import. A React renderer and a Vite plugin
build on them and are not here yet.

## @silk/ui

[packages/ui](packages/ui) is the node and event API. Its primitives are the tree's own (box,
text, input, image, icon, canvas). Its methods and its event flow are the DOM's.

```js
import { createBox, createText, mount } from "@silk/ui";

const label = createText("Click me");
const button = createBox({ width: 180, height: 70, backgroundColor: "rgb(0, 100, 200)" }, label);
button.tabIndex = 0;
button.look("hover").set({ backgroundColor: "rgb(0, 120, 230)" });

let clicks = 0;
button.addEventListener("click", () => {
  label.data = "Clicked " + ++clicks;
});

mount(createBox({ width: 400, height: 300 }, button));
```

- **Nodes.** `createBox(style, ...children)`, `createText(data)`, `createInput(style)` and
  `createNode(kind)`. A node has `append`, `appendChild`, `insertBefore`, `removeChild`,
  `remove`, `parentNode`, `childNodes` and the sibling getters. `destroy()` frees a node and
  its subtree. `mount(node)` makes a node the root.
- **Style.** `node.style.set({ ... })` sets properties by their camel case names. Numbers are
  CSS pixels, except for unitless properties such as `opacity` and `flexGrow`. `null` takes a
  property out. `node.look("hover")` (also `active`, `focus`, `focusVisible`) is the look the
  tree lays over the base in that state.
- **Events.** `addEventListener(type, listener, options)` with `capture` and `once`. An event
  runs the capture phase from the root down, the target, then bubbles, with
  `stopPropagation`, `stopImmediatePropagation` and `preventDefault`. Listeners run before
  the tree's default action, so `preventDefault()` on a `pointerdown` keeps focus where it
  is, as on the web. Events carry the DOM members of their kind (`clientX`, `button`,
  `detail`, `shiftKey`, `key`, `code`, `deltaY`, `inputType`). An `input` event has the new
  `value`.
- **Attributes.** `setAttribute(name, value)` for the tree's attributes (`tabIndex`,
  `disabled`, `label`, `testId`, `placeholder`, `multiline`, `readOnly`, `checked`,
  `selected`, `expanded`, `focusTrap`, `href`, `transition`). A name the tree does not have
  throws a `TypeError`.
- **Errors.** A listener that throws does not stop the dispatch. `setErrorHandler` receives
  the exception. Without a handler the host reports the first one after the input.

## The host

JavaScript runs on the thread that owns the tree.

```silk
let mut host = run JsHost.open(&memory, domain.handle())
run host.define(b"@silk/ui", package)
run host.module(source, b"app.js")
run host.flush(&mut tree)
run host.input(&mut tree, Input.press(10.0, 50.0))
run host.close()
```

Provide the `RuntimeAllocator` that `memory` observes as the `Allocator` of these calls.

- **Scripts and modules.** `evaluate` runs a script. `module` runs an ES module, and its
  imports load from the sources given to `define`. Relative specifiers resolve against the
  importing module's name. A bundler can also produce one script, which needs no `define`.
- **Promise jobs.** The host runs queued promise jobs after a script, after a module, and
  after each event it delivers, before the mutations reach the tree.
- **Nodes.** JavaScript calls native functions on the global `__ui` (`create`, `append`,
  `insertBefore`, `remove`, `destroy`, `root`, `setText`, `listen`, `style`, `clearStyle`,
  `attribute`, `focus`, `scrollTo`, `select`). Each call appends a mutation to one
  ui-protocol batch and returns. `JsHost.flush` applies the batch to the tree. `style` takes
  CSS text and parses it with css-style, so every property the tree knows is available.
- **Events.** `JsHost.input` runs one input: the tree queues its event records (`begin`), the
  host calls `__ui.dispatch(kind, target, a, b, modifiers, d, e, first, second)` for each,
  the tree runs or skips the default action depending on whether a listener prevented it
  (`finish`), and the mutations the listeners made are flushed. `kind` is the bit position
  of the event in the ui-protocol `LISTEN_*` flags. The numbers and strings depend on the
  kind, and `numbersOf` in [src/host.silk](src/host.silk) lists them.
- **Errors.** An uncaught exception fails the call with a `JsError` that carries its message.
  The host stays usable, and an input that failed in JavaScript still finishes in the tree.

## Status

- Tests: `silk test --manifest-path modules/js/tests/silk.toml --root src/tests.silk` from the
  repository root.
- Not here yet: a console, timers, unhandled rejection reports, images and canvas commands
  from JavaScript, the window host, the React renderer and the Vite plugin.
