# ui-js

Runs a JavaScript application on a UI tree, with the [SilkJS](https://github.com/silk-lang/lib-silkjs)
engine embedded in the process. Three parts are here: the Silk host with its native bridge,
`@silk/ui`, the node and event API, and `@silk/ui-react`, a React renderer on it. A Vite plugin
with hot reload is not here yet.

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

## @silk/ui-react

[packages/ui-react](packages/ui-react) renders React components to the tree. Host elements are the
tree's node kinds, and strings in children become text nodes.

```jsx
import { useState } from "react";
import { createRoot } from "@silk/ui-react";

function Counter() {
  const [clicks, setClicks] = useState(0);
  return (
    <box
      tabIndex={0}
      style={{ width: 180, height: 70, backgroundColor: "rgb(0, 100, 200)" }}
      hoverStyle={{ backgroundColor: "rgb(0, 120, 230)" }}
      onClick={() => setClicks(clicks + 1)}
    >
      Clicked {clicks} times
    </box>
  );
}

createRoot().render(<Counter />);
```

- **Props.** `style`, and `hoverStyle`, `activeStyle`, `focusStyle` and `focusVisibleStyle`
  for the looks of those states. `onClick`, `onPointerDown`, `onKeyDown`, `onInput` and so
  on for every event of the tree, with a `Capture` suffix for the capture phase. Listeners
  receive the `@silk/ui` event. Every other prop is a tree attribute (`tabIndex`, `testId`,
  `label`, `disabled`, `placeholder`).
- **Inputs.** `value` on `<input>` is controlled as in React DOM: the field shows what the
  component keeps, whatever was typed.
- **Timing.** `root.render` commits before it returns, so the first frame of a window has
  the content. A state change in a click, key or input listener commits before the host
  applies the mutations, so the next frame shows it. Other updates go through React's
  scheduler on the host's timers.
- **JSX.** Set the JSX import source to `@silk/ui-react`, or use React's own runtime: both
  work.

[examples/react-counter](examples/react-counter) bundles a counter with Vite into one ES
module. From `modules/js`, `npm ci && npm run build`, then from the repository root:

```sh
silk run --manifest-path modules/js/demo/silk.toml modules/js/examples/react-counter/dist/app.js
```

React 19.3 with react-reconciler 0.34 runs on the engine as it is: the bundle needs only
the web globals below.

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

## Web globals

Every realm starts with the globals of [src/prelude.js](src/prelude.js) on top of the
engine's ECMAScript: `setTimeout`, `setInterval`, `requestAnimationFrame`, `queueMicrotask`,
`performance.now`, `console` and `reportError`. They sit on native timer, clock, frame and
log functions, and the host decides what those mean:

- `JsHost.tick(seconds, animation)` moves the clock, runs the timers that are due, and with
  `animation` the frame callbacks. `nextDeadline` and `wantsFrame` tell a loop when to wake.
- `JsHost.takeLogs` hands over the console lines.

`silk task embed-assets` regenerates `src/generated_prelude.silk` after an edit to
`prelude.js`.

## In a window

[window](window) is `ui-js-window`: `JsApp` and `JsClient`, a client of the window host
(`ui-tree-window`). It runs the entry module at start, delivers event records between the
tree's `begin` and `finish`, runs timers and animation frames on the host's clock, and
prints console lines on standard error. An uncaught exception is printed as a browser
console prints it, and the window keeps running.

[demo](demo) is a counter in JavaScript:

```sh
silk run --manifest-path modules/js/demo/silk.toml
```

Run it from the repository root. `silk task native check` runs it with `--check`.

## Status

- Tests: `silk test --manifest-path modules/js/tests/silk.toml --root src/tests.silk` from the
  repository root for the host, `npm test` in `modules/js` for the JavaScript packages
  against a stand-in for the native functions, and
  `silk test --manifest-path modules/js/examples/tests/silk.toml --root src/tests.silk` for
  the bundled examples on the engine (build them first).
- Not here yet: unhandled rejection reports, images and canvas commands from JavaScript, and
  the Vite plugin with hot reload.
