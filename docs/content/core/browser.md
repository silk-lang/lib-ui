# In the browser

A Silk UI program runs in a web page as WebAssembly. The page gives it real DOM nodes, so the browser does layout, text, focus, scrolling and accessibility, and your program does what it always does.

> **Note:** This is the host side of the picture in [Silk UI at a glance](/core/): the program stays the same, and the page provides the screen and the services.

This page builds the dice program from [Commands](/core/commands/) for the web. It is four files.

## The program

The program is `dice.silk`, unchanged. It asks for the standard library's `Random` service and knows nothing about browsers.

## The entry point

::source examples/apps/dice-web/src/main.silk

This file is everything that is specific to the browser.

- `open` and `call` are the two functions the page calls. `open` runs once and makes the program. `call` runs for everything after: an event, a timer, a new location. You write them once and never touch them again. The three type arguments are your model, message and command types.
- `OsRandom` is the real die. It is the standard library's provider of `Random`, the same one a native program uses: in a page it asks the browser's `crypto.getRandomValues`. Nothing about it is specific to the browser.
- The `static if` around the two functions keeps them out of any build that is not WebAssembly, because only a page calls them.
- `Effect.provideMut<Random>(&mut random)` hands the program its service. A program with more services has one such line for each.

## The page

::source examples/apps/dice-web/web/index.html

`mount` loads the program into an element. It supplies the functions the standard library's providers import, such as the random bytes `OsRandom` asks for, so this page passes nothing else. A program that calls functions of its own page passes them as `imports`, as the next section shows.

| Option | What it is |
| --- | --- |
| `wasm` | Where the program is |
| `root` | The element it draws in |
| `imports` | Functions of the page that the program calls |
| `fonts` | Font families by number: `{ 1: "Inter, sans-serif" }` is `css.fontFamily(1)` |
| `loaders` | Loaders for URL schemes of the app's own: `{ db: async (url) => blob }` for `h.image("db:42")` |
| `base` | The path the site lives under, such as `"/docs"` |

## The manifest

::source examples/apps/dice-web/silk.toml

`ui_app_dom` is the browser backend. The third dependency is this site's examples, where `dice.silk` lives. In a package of your own the program would sit in `src/` next to `main.silk`.

## Build and serve

::source examples/apps/dice-web/build.sh

```sh
docs/examples/apps/dice-web/build.sh serve
```

The build makes three files: the program as `dice.wasm`, the page, and `silk-ui-dom.js`, the small script that connects the two. Any static file server can serve them.

## Talking to JavaScript

There are two directions.

**The program calls the page** through a service. When the standard library has the service, such as `Random` above or a clock, its provider already works in a page. For something only your page can do, declare a service of your own and an implementation that calls an imported function:

```silk
unsafe extern "C" fn hostShare(bytes: ?[*]const u8, length: usize) -> () as "app#share"
```

and pass the function in `imports` as `app: { share: (pointer, length) => ... }`.

**The page calls the program** through a port. `mount` returns a handle, and `page.post(name, text)` sends text to the program's `subs.port` of that name:

```js
const page = await mount({
  wasm: "./app.wasm",
  root: document.getElementById("app"),
  imports: {
    app: {
      // Start the request and return. The answer comes back through the port.
      load: (id) =>
        fetch(`/items/${id}`)
          .then((response) => response.text())
          .then((text) => page.post("item", text)),
    },
  },
});
```

```silk
subs.port(1, "item", |text| Message.LoadedItem { text: move text })
```

That pair is how every slow thing works in a page: the command starts it and returns, and the result arrives as a message when it is ready.

## Pages that are there before the program

A program can be drawn to markup ahead of time, on a server or at build time, and the page can show that markup while the program loads. When it has loaded, `mount` adopts the nodes that are already there instead of making new ones.

```silk
let mut html = Html.make()
let markup = run render<Dice, Message, Command>(&mut html, "/")
  |> Effect.provideMut<Random>(&mut random)
```

`render` runs the program up to its first view at a path and returns the markup. Put it inside the element that `mount` gets as `root`.

This site is built that way. Every page is an `index.html` with its content already in it, so it shows at once, works without JavaScript for reading, and is taken over by the program when that arrives. The site's source is in `docs/` of the repository, and `docs/src/main.silk` is its entry point.

## What is different from a native window

The program is the same, and it behaves the same. A few things differ because the browser is in charge of them:

- Text is laid out by the browser, with the fonts the page has.
- `css.raw` values go to the browser as they are, so everything CSS can do is available.
- There is one window. A program that declares more [windows](/native/windows/) hears that they failed to open.

## Recap

- The program compiles to WebAssembly and a small script mounts it on real DOM nodes.
- The entry point exports two functions and provides the program's services.
- Pages can be drawn to markup ahead of time and taken over when the program loads.
- The same program runs in a native window with a different host.

Next: [Native apps](/native/).
