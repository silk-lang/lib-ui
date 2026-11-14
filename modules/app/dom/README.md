# ui-app-dom

The document backend of ui-app: the same `Program` that runs on the tree renderer, shown with
real DOM nodes, or written out as markup. The browser does layout, text, focus and scrolling.

- `src/dom.silk`: `Dom`, a `Backend`. Each render's mutations are encoded into one buffer
  (`src/wire.silk`) and handed to the page; events come back one record at a time.
- `src/templates.silk`: repeated subtrees. A subtree like one the page already made (a row of
  a list) is sent as a copy of it with the texts that differ, and the page makes it with one
  `cloneNode` in place of a call per node and attribute.
- `src/page.silk`: `open` and `call`, the two functions a program exports.
- `src/html.silk`: `Html`, a `Backend` that keeps the document as text, and `render`, which
  renders a program at a path to markup: for a server, or a static build.
- `js/silk-ui-dom.js`: the page's side. `mount` loads the program, applies mutations and sends
  events, timers, frames, resizes and locations. It hydrates markup that is already there.

## Using it

Export the two functions the page calls:

```silk
export "C" fn open() -> ?*mut u8 as "silk_ui_open" {
  let mut allocator = Allocator.systemAllocatorProvider()
  return run Effect.catchAll(page.open<App, Message, Command>(), page.unopened)
    |> Effect.provideMut<Allocator>(&mut allocator)
}

export "C" fn call(token: ?*mut u8, op: u32, a: f64, b: f64, c: f64) -> f64 as "silk_ui_call" {
  let mut allocator = Allocator.systemAllocatorProvider()
  return run Effect.catchAll(page.call<App, Message, Command>(token, op, a, b, c), page.failed)
    |> Effect.provideMut<Allocator>(&mut allocator)
}
```

What the commands require is provided in `call`, with one more `Effect.provideMut`. Build for
`wasm32-unknown-unknown` and mount it:

```js
import { mount } from "./silk-ui-dom.js";

const page = await mount({
  wasm: "./app.wasm",
  root: document.getElementById("app"),
  fonts: { 1: "Inter, system-ui, sans-serif" }, // css.fontFamilyNumber(1); Font constants need nothing here
  // h.image("logo.png") and h.icon("chevron.svg") load relative to the app's root;
  // loaders add schemes of the app's own.
  loaders: { db: async (url) => new Blob([await read(url)]) }, // h.image("db:42")
  base: "", // "/docs" when the site is under /docs
  imports: { app: { share: (pointer, length) => {} } }, // the program's own host imports
});
```

The standard library's providers need nothing here: `mount` supplies `silk.random` for
`OsRandom` (from `crypto.getRandomValues`) and `silk.clock` for `OsSystemClock` and
`OsMonotonicClock` (from `performance`), so a program provides those services the same way in a
page as on a machine.

## Links and locations

`h.link("/guide", ...)` is an `a`. A click on it moves the program's location and the address
bar (`history.pushState`) without loading a page; back and forward move the program too. The
program hears of each move through `subs.location`, and of where the document opened before
its first render. `Update.navigating(path)` moves the location from an update.

## Work that outlives a command

A command ends before the next message. For a request or a timer, the command starts the work
through a host import and returns; the page posts the result when it has it, and
`subs.port(key, "name", |text| ...)` makes it a message:

```js
imports: { app: { load: (id) => fetch(`/items/${id}`).then((r) => r.text()).then((t) => page.post("item", t)) } }
```

## Server rendering, hydration and static builds

`render` runs a program up to its first view at a path and returns the markup: `init`, its
commands, the location and viewport subscriptions, then one render.

```silk
let mut html = Html.make()
run html.setBase("/docs")
let markup = run render<App, Message, Command>(&mut html, "/guide")
  |> Effect.provideMut<Store>(&mut store) // what the commands require, on the server
```

Put the markup inside the element `mount` gets as `root`. `mount` then adopts the nodes by
their ids instead of making new ones, applies everything the program says (so a different
viewport or saved state is put right), and removes what the program did not claim.

A static build is that in a loop. `docs` is a whole program built this way, the
Silk UI docs: its wasm build is the program, and its native build writes an `index.html` per
route.

```sh
docs/build.sh serve          # http://localhost:8017
docs/build.sh --base /docs   # for a site under /docs
```

## What the page does not do

- Virtual lists and decoded (raw pixel) images are ignored. Virtual lists are not core; the
  browser scrolls real nodes.
- Hydration keeps the nodes but sets every property again.
- An image or icon a program defines from bytes becomes a blob URL; a server render shows
  only the ones it was given an address for.

## Gaps left in ui-app

- No command suspends: slow work comes back through a port.
- A `Submodel`'s view sees only its own model: shared context such as a theme is copied into
  each child through `Receives`.
- `h.transition` is CSS text that only a document backend applies.
- `impl Program for Model` must be in the model's module, so a model and its messages cannot
  be split from `update` and `view` without a wrapper type.
- The generic runtime calls need their type arguments written out.
- ui-app still depends on ui-tree, so a DOM program links it too.
