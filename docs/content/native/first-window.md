# Your first window

A native app is a Silk UI program plus one small file that opens a window. This page takes the counter from [Your first program](/core/first-program/), unchanged, and runs it as a desktop app.

## The app

::shot native-hello "The counter, as a window would show it."

> **Note:** Where your browser has WebGPU (Chrome and Edge do), the box above is not a picture. It is this program, drawn by the same GPU renderer a native window uses, with a canvas in the page as its window. Click it. In other browsers you see a picture the docs build drew from the same program.

It is two files. The manifest:

::source examples/apps/hello/silk.toml

And the entry point:

::source examples/apps/hello/src/main.silk

That is the whole app. The counter itself is the file you already read: `counter.silk` has no idea it is in a window.

## Run it

From the root of the repository:

```sh
silk task native demo docs/examples/apps/hello
```

On Linux the window system's headers have to be installed first:

```sh
sudo apt-get install libx11-dev libxkbcommon-dev libwayland-dev wayland-protocols
```

## The window

::source examples/apps/hello/src/main.silk "effect fn counter"

- `Window.make(title, width, height)` describes the window. Nothing opens yet.
- `window.font(1, "system-ui, sans-serif")` says what font family number 1 means here. Styles name families by number, as in `css.fontFamily(1)`, and each host decides which fonts that is. A list of names works as in CSS: the first one that is installed wins.
- `systemFonts()` loads the fonts installed on the machine. An app that ships its own fonts makes a `FontCollection` from those instead.
- `show` opens the window and runs the program in it. It returns when the window closes, with the exit code.

The four type arguments of `show` are the model, the message type, the command type, and what the commands need. The counter has no commands, so those are `NoCommand` and `never`.

## Two threads

::source examples/apps/hello/src/main.silk "pub fn main"

Desktop systems want their event loop on the main thread. `launch` keeps it there and starts your app on a thread of its own. You write these few lines once per app.

::source examples/apps/hello/src/main.silk "fn app"

`app` is where the program gets what it needs. Here that is memory, and a handler that turns a failure into an exit code. An app with [commands](/core/commands/) provides their services in the same place, as the next page shows.

## What you get without writing it

The window draws with the GPU and lays out with the same CSS rules as a browser. Because of that, things you expect from a web page work in the window too, without code in your program:

- Text selection, the caret, copy and paste in text fields, and input methods.
- Scrolling with the wheel, the trackpad and the keyboard.
- Tab and Shift+Tab between controls, and a focus ring for the keyboard.
- Hover, press and focus looks.
- A screen reader's view of the window, from the roles and labels in your view. This is implemented on macOS today.

## Next

- [The shell](/native/shell/) gives the app a menu bar, file dialogs and the clipboard.
- [More windows](/native/windows/) opens a second one.
- [Devtools](/native/devtools/) shows what the app is doing while it runs.
