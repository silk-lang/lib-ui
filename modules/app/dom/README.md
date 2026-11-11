# ui-app-dom

The DOM backend of ui-app: the same `Program` that runs on the tree renderer, shown with real
DOM nodes. The browser does layout, text, focus and scrolling.

- `src/dom.silk`: `Dom`, a `Backend`. Each render's mutations are encoded into one buffer
  (`src/wire.silk`) and handed to the page; events come back one record at a time.
- `src/page.silk`: `open` and `call`, the two functions a program exports.
- `js/silk-ui-dom.js`: the page's side. `mount` loads the program, applies mutations and sends
  events, timers, frames and resizes.

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

await mount({
  wasm: "./app.wasm",
  root: document.getElementById("app"),
  fonts: { 1: "Inter, system-ui, sans-serif" }, // css.fontFamily(1)
  imports: { app: { random: () => Math.random() } }, // the program's own host imports
});
```

`modules/app/site` is a whole program on it, the silk-ui docs:
`modules/app/site/build.sh serve`, then http://localhost:8017.

## What the page does not do yet

- These mutations are dropped: anchors, virtual lists, grid templates, icons and images.
- Focus traps are not implemented.
- Font families are the `fonts` map of `mount`; a program cannot define one.

## Gaps the docs site found in ui-app

- Commands run to completion inside the loop, so there is no fetch or delay.
- No links, URLs or routing.
- No transitions or animations in style.
- A `Submodel`'s view sees only its own model: shared context such as a theme has to be copied
  into each child through `Receives`.
- No span: rich text is a box per styled run.
- `Document` has no images, canvas, grid, overlays, focus control or scroll control.
- Several CSS properties have no function and go through `css.declare` with `css.text`.
- `impl Program for Model` must be in the model's module, so a model and its messages cannot
  be split from `update` and `view` without a wrapper type.
- The generic runtime calls need their type arguments written out.
- ui-app still depends on ui-tree, so a DOM program links it too.
