# ui-js

Runs a JavaScript application on a UI tree, with the [SilkJS](https://github.com/silk-lang/lib-silkjs)
engine embedded in the process. Four parts are here: the Silk host with its native bridge,
`@silk/ui`, the node and event API, `@silk/ui-react`, a React renderer on it, and `@silk/vite`,
a Vite plugin that builds an application and, in development, replaces edited modules in
the running window.

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
  property out. `fontFamily` takes CSS `font-family` text (`"monospace"`, `"Noto Sans, sans-serif"`),
  resolved in the host's font collection. Grid layouts take the CSS grid properties
  (`gridTemplateColumns: "auto 1fr"`, `repeat()`, `minmax()`, named lines and
  `gridTemplateAreas`, `gridArea`, `gridColumn: "span 2"`); numbers for the placement
  properties are line numbers. Grid properties apply from the base look only. `node.look("hover")` (also `active`, `focus`, `focusVisible`) is the look the
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
  `selected`, `expanded`, `focusTrap`, `href`, `cursor`, `transition`). A name the tree does
  not have throws a `TypeError`. `cursor` takes the CSS keywords (`pointer`, `text`, `grab`,
  `not-allowed` and the resize ones).
- **Links.** A node with an `href` is a link, as an `<a>` is: a click on it or inside it that
  no listener prevented calls `open(href)`, which hands the address to the host.
- **Markdown.** `parseMarkdown(text, options)` returns the syntax tree of the text in
  the shape of [mdast](https://github.com/syntax-tree/mdast), the tree remark gives, so
  renderers written for remark's tree work on it, and an application needs no Markdown
  parser in its bundle. The parser is the Silk standard library's (`silk.markdown`):
  CommonMark with GitHub's tables, strikethrough, task lists and autolinks. `gfm: false`
  turns those four off, each can be set alone (`tables`, `strikethrough`, `taskLists`,
  `autolinkLiterals`), and `footnotes`, `frontmatter` (a `yaml` or `toml` node) and
  `alerts` (`> [!NOTE]`, a node of type `alert` with a `kind`) turn on more. Nodes have no
  `position`.
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

[examples/react-counter](examples/react-counter) is a starter page in React where the counter
is the page: click anywhere and the number rolls, with rings, sparks and a field of dots
that answer the click and the pointer. The count and the theme are React state;
[motion.js](examples/react-counter/src/motion.js) draws every frame on nodes it gets by
ref. It is bundled with Vite into one ES module. From `modules/js`, `npm ci && npm run build`, then from the repository root:

```sh
silk run --manifest-path modules/js/demo/silk.toml modules/js/examples/react-counter/dist/app.js
```

React 19.3 with react-reconciler 0.34 runs on the engine as it is: the bundle needs only
the web globals below.

## @silk/vite

[packages/vite](packages/vite) is the Vite plugin. A host evaluates one ES module, so the
plugin sets up a library build with a single output file, the JSX runtime of
`@silk/ui-react`, and `process.env.NODE_ENV` from the Vite mode.

```js
import { defineConfig } from "vite";
import silk from "@silk/vite";

export default defineConfig({
  plugins: [silk({ entry: "src/main.jsx", host: { command: "path/to/host" } })],
});
```

`vite build` writes `dist/app.js`, the bundle a host runs in production.

### APIs the runtime does not have

A realm has ECMAScript, the web globals below and `@silk/ui`: no `fetch`, `URL`, `Intl`,
`document`, `process` or Node modules. Libraries written for browsers or Node often expect
them, so the plugin reads every module of a build and reports the ones that are used, and
by whom:

```
APIs used here that a ui-js runtime does not have:
  fetch (network): src/api.js, ky
  Intl (intl): date-fns
  node:fs (node): some-package
```

- A name counts when a module reads it as a global. A `typeof` test for it, a local of the
  same name, `process.env.NAME` and a `require("…")` the bundler resolves do not count.
- `apis: "error"` fails the build instead, `apis: "off"` turns the report off, and
  `allow: ["fetch"]` leaves out names the application provides itself.
- Under the dev server the warning comes when the module is first served.
- At run time, the window host adds a line of explanation to an uncaught
  `ReferenceError: … is not defined`.

The areas in parentheses are the units a build will choose from, once the engine's
features can be picked for each build.

### Development: `vite`

Under the dev server the host runs the application's modules as Vite serves them, and an
edit replaces only the modules it touches:

- A component file (every export is a React component) is swapped where it is with React
  Fast Refresh. Component state and the rest of the application stay as they were.
- Any other module passes the update on to its importers. When nothing accepts it, the
  window gets a new realm and the application starts again.
- `import.meta.hot` works as in Vite: `accept`, `dispose`, `invalidate`, `data`.
- A build error is printed and the running application is left alone.

With `host` set the plugin starts that binary with `--dev <port>`; without it, it prints
the port for a host you start yourself. Closing the window ends the session.

How it works: the plugin adds a Vite environment named `silk` and listens on a local TCP
port. The host connects when its window opens (`DevTools.server(port)`), and the server sends one
script first: Vite's module runner, bundled, with the host's line transport under it
(`__ui.devSend` out, `__ui.devMessage` in). The runner asks the server for each module,
already transformed, and evaluates it in the realm. Dependencies are pre-bundled by Vite,
so CommonJS packages such as React load as ES modules. The host needs no module resolution
of its own.

### Development without the dev server: `vite build --watch`

`vite build --watch --mode development` rebuilds the bundle on every change; with `host`
set, the plugin starts that binary with `--watch <bundle>` after the first build, and the
window reloads the whole application after each later one: the plugin writes
`<bundle>.stamp` after a successful build, the window host looks at that file five times a
second (`JsApp.watch`), and when it changed the host destroys the application's nodes,
starts a new realm and runs the new bundle. JavaScript state does not survive. This is
the same code path as production, so it is the mode to check a bundle in.

For the React example, from `modules/js/examples/react-counter`:

```sh
silk build --manifest-path ../../demo/silk.toml --profile dev
export SILK_UI_HOST=$PWD/../../../../build/llvm/<target>/dev/ui-js-demo
npm run dev     # dev server, Fast Refresh
npm run watch   # rebuild and reload
```

The `dev` profile is the development host with optimizations on. Use it for JavaScript
work: in a plain debug build the engine itself is unoptimized, and JavaScript runs tens of
times slower (the starter page's motion drops well under 60 frames a second there).
`ui-js-bench-frames <bundle>`
([bench/frames](bench/frames)) prints what a frame of an application costs in JavaScript,
in applying its mutations and in the tree, without a window.

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
  `attribute`, `focus`, `scrollTo`, `select`, `fontFamily`). Each call appends a mutation to one
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
`performance.now`, `console`, `reportError` and `open`. They sit on native timer, clock, frame and
log functions, and the host decides what those mean:

- `JsHost.tick(seconds, animation)` moves the clock, runs the timers that are due, and with
  `animation` the frame callbacks. `nextDeadline` and `wantsFrame` tell a loop when to wake.
- `JsHost.takeLogs` hands over the console lines.
- `JsHost.takeOpened` hands over the addresses `open(url)` asked for (http, https and mailto
  only). The window opens them with `xdg-open` on Linux and `open` on macOS, without waiting
  for it; other systems print that they could not.

`silk task embed-assets` regenerates `src/generated_prelude.silk` after an edit to
`prelude.js`.

## In a window

[window](window) is `ui-js-window`: `JsApp` and `JsClient`, a client of the window host
(`ui-tree-window`). It runs the entry module at start, delivers event records between the
tree's `begin` and `finish`, runs timers and animation frames on the host's clock, and
prints console lines on standard error. An uncaught exception is printed as a browser
console prints it, and the window keeps running.

The window client takes the host's tools as a type: `JsClient.make(NoTools {})` runs the
application as it was built, and `JsClient.make(DevTools.make())` adds the development ones
from [window/dev](window/dev) (`ui-js-window-dev`): `DevTools.watch` for `--watch`,
`DevTools.server` for the dev server. Only a client with `DevTools` serves the inspector
(`WindowClient.servesInspector`).

[demo](demo) is the starter page in plain JavaScript, the React example's twin. Its window
has a transparent title bar (`JsClient.titleBar`, `titleBarHeight`): on macOS the page
reaches the top edge and the window controls sit over the bar it draws; other systems keep
their title bar.

```sh
silk run --manifest-path modules/js/demo/silk.toml
```

`@silk/ui` and the starter page are part of the binary (`uiPackage()` from `ui_js.lib` and
`Source.read("app.js")`), so the executable runs from any directory. After an edit to
`packages/ui/src/index.js`, `silk task embed-assets` regenerates
`src/generated_library.silk`. `silk task native check` runs the demo with `--check`.

### Production builds

A production build leaves out everything that is there for development: the dev server
client, `--watch` reloading, and the inspector server. The demo's `production` profile
builds [demo/src/production.silk](demo/src/production.silk), which runs `NoTools` and
passes an inspector that is off; since its client answers `servesInspector` with a
constant false, the window host's inspector code is not in the program either.

```sh
silk build --manifest-path modules/js/demo/silk.toml --profile production
```

Engine features are chosen per build too. The bridge answers
`EngineServices.includesIntl` and `includesTemporal` with false (a realm here installs
neither), so the engine's ECMA-402 and Temporal code and their CLDR and time zone tables
are left out: `localeCompare`, `toLocaleString` and the like give their
locale-independent results, and a local `Date` string ends at its offset. The production
demo is 38.0 MB against 44.2 MB for the release build before these changes (5.2 MB from
the engine features, 1.0 MB from the tools and the inspector). WebAssembly is not part of
the engine here (it lives in the SilkJS runtime, which ui-js does not link).

## Status

- Tests: `silk test --manifest-path modules/js/tests/silk.toml --root src/tests.silk` from the
  repository root for the host, `npm test` in `modules/js` for the JavaScript packages
  against a stand-in for the native functions, and
  `silk test --manifest-path modules/js/examples/tests/silk.toml --root src/tests.silk` for
  the bundled examples on the engine (build them first).
- Not here yet: unhandled rejection reports, images and canvas commands from JavaScript,
  source maps for errors under the dev server, and choosing engine features beyond Intl and
  Temporal for each build.
- Memory, release builds on Linux x86-64 under Xvfb with a software GPU, resident after six
  seconds: the Silk window demo 155 MB, the JavaScript counter 169 MB, the React counter
  174 MB. The GPU stack is most of each; the engine with `@silk/ui` adds about 14 MB and
  React about 5 MB more.
