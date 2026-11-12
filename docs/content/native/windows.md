# More windows

A program can show more than one window. It does not open and close them. It **declares** the windows it wants, as a function of its model, and the runtime opens and closes OS windows to match.

## Swatches

::shot native-swatches "The first window. Where the browser has WebGPU it runs here. A page can show one window only, so the second one is the picture below."

::shot native-swatches-preview "The second window, with the blue swatch chosen. It shows the same model."

::source examples/src/native/swatches.silk

## Windows are a function of the model

::source examples/src/native/swatches.silk "fn windows"

This is the same idea as `view` and `subscriptions`. After every update the runtime asks which windows the model wants now. A window that is new in the answer is opened. A window that is gone from it is closed.

So "the preview is open" is not something to keep in sync with the model. It *is* the model: `model.previewing`.

`w.window` takes four things:

| Argument | What it is |
| --- | --- |
| A key | Tells this window from the others, from one update to the next |
| A `WindowSpec` | The title and size it asks for |
| A view | What the window shows. It gets the same model as the first window |
| A close message | What to send when the user asks to close it |

`WindowSpec.titled("Preview").sized(240.0, 240.0)` is a resizable window of that size. Add `.fixed()` for one the user cannot resize.

## One model

Both windows show the same model, and a click in either one goes through the same `update`. Click a swatch in the first window and the second changes color, with no code that connects them.

That is the main difference from frameworks where every window is its own program and the two must send each other messages.

## Closing a window

::source examples/src/native/swatches.silk "effect fn update"

When the user presses the second window's close button, nothing closes. The program gets the close message, and decides. Here it sets `previewing` to false, the model stops declaring the window, and so the window closes.

A program could just as well ignore the request, or ask first.

## Hearing more from a window

`w.listen(key, handler)` hears the other things that happen to a declared window:

| Event | When |
| --- | --- |
| `WindowEvent.Resized { width, height }` | Its content changed size |
| `WindowEvent.Focused`, `WindowEvent.Blurred` | It took or lost the keyboard |
| `WindowEvent.Failed` | It could not be opened |

`Failed` is what a program hears where there can only be one window, such as [in a browser](/core/browser/). The first window keeps working.

## The entry point

::source examples/apps/swatches/src/main.silk

It is the same as [the first window's](/native/). Nothing in it mentions a second window.

```sh
silk task native demo docs/examples/apps/swatches
```
