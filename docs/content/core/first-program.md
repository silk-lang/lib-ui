# Your first program

This page reads one small program from top to bottom: a counter. It is the smallest thing that is still a whole Silk UI program, and every bigger program has the same parts.

## The program

Here it is, running. Click the buttons.

::demo counter

And here is all of its code. Nothing is left out.

::source examples/src/core/counter.silk

The rest of this page walks through it, one part at a time.

## The model

::source examples/src/core/counter.silk "pub struct Counter"

The **model** is everything the program remembers. Here that is one number.

There is no other state anywhere: no fields on components, no hooks, no stores. If the screen shows something, it is in the model or computed from it. That is what makes a Silk UI program easy to reason about. To know what the screen shows, you look at one value.

## Messages

::source examples/src/core/counter.silk "pub union Message"

A **message** says that something happened. The counter has three, one for each button.

Name messages as facts, in the past tense: `ClickedIncrement`, not `Increment`. A message does not say what to do. It says what the user did, and `update` decides what that means.

## Update

::source examples/src/core/counter.silk "effect fn update"

`update` takes the model and one message, and returns the next model. It is the only code that changes the model, so when a value is wrong there is exactly one place to look.

`Next.of(model)` means "this is the next model, and there is nothing else to do". Later pages return more than that: [commands](/core/commands/) to run, or a new [location](/core/routing/).

> **Note:** `update` takes the model by value and gives it back. Silk moves it in and out, so nothing is copied, and no other code can be holding on to the old one.

## Init

::source examples/src/core/counter.silk "effect fn init"

`init` makes the first model. It runs once, when the program starts.

## View

::source examples/src/core/counter.silk "fn view"

`view` describes the screen for a model. It is a plain function: the same model always gives the same screen. It never changes anything, it only describes.

`h` is the builder you describe the screen with. `h.row` is a box that lays its children out in a row, `h.box` a plain box, `h.number` a number as text. Each takes a list of attributes and a list of children.

The view is called again after every update. That sounds expensive and is not: Silk UI compares the new description with the last one and changes only what differs. Clicking `+` changes one text node.

## A view function

::source examples/src/core/counter.silk "fn button"

There are no components to learn. When a piece of the screen repeats, write a function that returns a `Node`. This one takes a label and the message a click sends.

`h.onClick(message)` is how the screen talks back: it says which message the program gets when this node is clicked. `h.style` is the node's look, and `h.hover` is its look while the pointer is over it.

## The whole loop

| Part | What it is | When it runs |
| --- | --- | --- |
| `init` | The first model | Once, at the start |
| `view` | The screen, for a model | After every update |
| `update` | The next model, after a message | For every message |

The user clicks, a message goes to `update`, `update` returns a model, `view` shows it. Then the program waits for the next message. [How a program runs](/core/how-it-runs/) follows one click all the way around.

## Run it yourself

The program above knows nothing about where it runs. It needs a host: a few lines that open a window or mount it in a page.

- [Your first window](/native/) runs this same counter as a native app.
- [In the browser](/core/browser/) builds a program for a web page.

To use Silk UI in a package of your own, add it to `silk.toml`:

```toml title="silk.toml"
[dependencies]
ui_app = { git = "https://github.com/silk-lang/lib-ui.git", rev = "<a commit>", path = "modules/app", package = "ui-app" }
```

The examples in these docs live in the same repository as Silk UI, under `docs/examples`, so their own manifests name it by path instead.
