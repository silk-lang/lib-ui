# In a window

So far the tree has drawn into memory. To put it on a screen, something has to own a window, a GPU surface, the system's input, and the timing of frames. That is the **window host**, `ui-tree-window`.

The host runs the loop. Your part is a client: two functions it calls.

## A counter in a window

::source examples/apps/tree-window/src/main.silk

::source examples/apps/tree-window/silk.toml

```sh
silk task native demo docs/examples/apps/tree-window
```

## The client

::source examples/apps/tree-window/src/main.silk "impl WindowClient"

A `WindowClient` has two functions that matter:

| Function | Called | Your job |
| --- | --- | --- |
| `start` | Once, before the first frame | Build the tree |
| `pump` | After input reached the tree | Take the events and answer them |

`Counter` is the client's own state, which the host keeps and hands back on every call.

The host does the rest. It turns the system's events into `Input`, dispatches them, asks for frames when the tree needs one, copies glyphs to the GPU, draws the scene, blinks the caret, serves the clipboard and input methods, and publishes the tree to screen readers.

> **Note:** The host hands the client the tree's engine, `UiTree`, and not the `Tree` of the earlier pages. So this client builds its nodes as a `Batch` of mutations with node numbers of its own, and reads events as flat records with a `kind` and a `target`. That is the same data as the direct calls, in its [protocol](/tree/protocol/) form. Moving the host to the `Tree` API is planned.

## Running it

::source examples/apps/tree-window/src/main.silk "effect fn counter"

`runWindow` takes the client's state, the fonts, mutations to apply before anything else, the window's options, an inspector, and the client. It returns when the window closes.

`Inspector.off()` runs without the inspector. A client that wants the [devtools](/native/devtools/) passes a started one instead, and they work on a bare tree exactly as they do on a Silk UI app, because they only ever look at the tree.

::source examples/apps/tree-window/src/main.silk "pub fn main"

As in a Silk UI app, the main thread keeps the system's event loop and the client runs on its own.

## Other hooks

The two functions above are enough for most clients. The interface has more, each with a default:

| Hook | For |
| --- | --- |
| `setup`, `configure`, `opened` | Preparing resources and window options before the window shows |
| `event` | Seeing native events before the tree does: menus, dialogs |
| `closing` | Keeping the window open, to ask about unsaved work |
| `poll`, `wakeAfter`, `nextDeadline` | Background work and timers |
| `layout`, `frame`, `scene`, `draw` | Custom layout passes and drawing your own GPU content with the tree's |

## More than one window

A tree can hold several **roots**: separate top-level trees that share fonts, the glyph atlas and one space of node ids. The host shows every root in an OS window of its own.

```silk
let mut options = RootOptions.default()
options.title = run String.copy("Second")
run batch.openRoot(2, 40, move options)
```

The client opens a root with a number it chooses, a node, and options such as a title and a size. What happens to that window comes back as root events: resized, focused, a request to close. The host never closes a root on its own. The client answers a close request with `batch.closeRoot(2)`, or does not.

This is what Silk UI's [windows](/native/windows/) are built on.

## In a browser tab

The same host runs in a browser: the program is built for WebAssembly and draws on a canvas with WebGPU. That is a different thing from Silk UI's [document backend](/core/browser/), which uses real DOM nodes. On a canvas the tree does its own layout and text, pixel for pixel as it does natively.

The repository's small window counter runs this way. This serves it and prints the address to open:

```sh
silk task browser serve
```
