# Testing without a window

A native app is a program plus services. Swap the services, and the whole app runs inside a test: no window, no display, no files on disk. This page tests Pad from [The shell](/native/shell/), menus and dialogs included.

```sh
silk test --manifest-path docs/tests/silk.toml --root src/tests.silk
```

## The test

::source tests/src/native.silk "effect fn padBody"

::source tests/src/native.silk "test effect fn aNativeAppWithoutAWindow"

## A shell that takes notes

`ShellLog` is a `Shell` for tests. It does nothing on a screen. It writes down what the program asked of it, one line for each request, and keeps a clipboard of its own.

```silk
let mut shell = ShellLog.make()
run padBody() |> Effect.provideMut<Shell>(&mut shell)

run Testing.expect(shell.has("setTitle Pad (edited)"), "the title was marked")
```

After the program has run, the test reads the log. `shell.has(line)` asks whether a request was made.

## Saying what a window would say

A real window tells the program things through subscriptions: a menu item was chosen, a dialog closed. In a test, the test says them, by posting to the ports those subscriptions listen on.

| Port | Posted text | Is heard by |
| --- | --- | --- |
| `PORT_MENU` | The action, as a number: `"3"` | `subs.menuAction` |
| `PORT_FILES` | The request, then one path per line: `"2\n/tmp/note.txt"` | `subs.files` |
| `PORT_APPEARANCE` | `"dark"` or `"light"` | `subs.appearance` |
| `PORT_FOCUS` | `"1"` or `"0"` | `subs.windowFocus` |
| `PORT_CLOSE` | Anything | `subs.closeRequested` |

So "the user chose Save As, picked a file, and it was written" is three lines:

```silk
run post(&mut app, &mut page, PORT_MENU, "3")
run post(&mut app, &mut page, PORT_FILES, "2\n/tmp/note.txt")
run Testing.expect(!app.model.value.dirty, "a save cleans the note")
```

A dialog that was cancelled is the request with no paths: `"2"`.

## A disk in memory

::source tests/src/native.silk "struct OneFile"

::source tests/src/native.silk "impl Disk for OneFile"

The program's own service gets the same treatment. This disk holds one file, in memory. After the test, `disk.text` is what the app saved.

## The real window, checked

The tests above cover the program. One thing they cannot cover is the window itself: that the GPU draws what the program describes.

For that, a window can run in **check mode**. It opens for real, clicks one node, waits for another to appear, compares what the GPU drew with the same frame drawn on the CPU, and exits with the result.

```silk
let mut window = run Window.make("Counter", 360.0, 160.0)
window.checking("+", "1")
```

`checking(click, expect)` names the node to click and the node that must show afterwards. It is meant for one smoke test per app, run in CI on a machine with a display.

## The same program everywhere

Look back at what stayed the same on every page of this guide: the program. The counter ran in a page, in a window and in a test. Pad ran in a window with real menus and in a test with a log.

| Where | Who draws | Who provides the services |
| --- | --- | --- |
| A native window | The UI tree, on the GPU | The window's shell, your own structs |
| [A web page](/core/browser/) | The browser's DOM | Structs that call JavaScript |
| A test | Nobody, or the tree without a GPU | Structs the test controls |

The window draws through the [UI tree](/tree/). You do not need to know it to build an app, but if you want to see what is underneath, or build something other than an app on it, that guide is next.
