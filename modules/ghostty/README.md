# ui-ghostty

Terminals on the UI tree, through [libghostty-vt](https://mitchellh.com/writing/libghostty-1-0)
1.0.1. Ghostty parses the program's output and keeps the screen and the scrollback; Silk draws
that screen with ordinary tree nodes, so a terminal works wherever ui-app works: a native window
on macOS, Windows, X11 and Wayland, and a page in a browser.

| Package | What it is |
| --- | --- |
| [vt](vt) (`ghostty-vt`) | The libghostty-vt wrapper: an owned `Terminal`, key, paste, mouse and focus encoding, selection gestures, scrolling, styled snapshots and text export. Nothing about drawing |
| [.](src/view.silk) (`ui-ghostty`) | `TerminalView`, a ui-app component: cells, cursor, selection, scrollback, keys, IME text, paste, copy, mouse reporting |
| [demo](demo) (`ui-ghostty-demo`) | A simple terminal app: the user's shell on a PTY (ConPTY on Windows) in a native window |
| [web](web) (`ui-ghostty-web`) | The component in a page: libghostty-vt in WebAssembly, drawn as DOM nodes, with a small built-in shell |
| [tests](tests) | The component on a real tree, driven through the tree's dispatch path |

## Setting up

libghostty-vt is a static library that is not in the repository. Fetch or build it once per
checkout:

```sh
python3 modules/ghostty/vt/scripts/prepare          # for this machine
python3 modules/ghostty/vt/scripts/prepare --wasm   # also for the browser
```

macOS and Windows use the release's prebuilt libraries. Linux and WebAssembly build the
release's source with [Zig 0.17](https://ziglang.org/download/) (`ZIG=/path/to/zig` names
another executable); the build is offline once the two tarballs are downloaded. Every download
is checked against the release's SHA-256. The output goes to `vt/native/build/`, which git
ignores.

The WebAssembly build is patched so that Ghostty allocates through the module's `malloc` and
`free`: Silk's heap owns the end of the one linear memory, and a second allocator growing that
memory by itself would hand out the same bytes.

## Using the component

`TerminalView` belongs to your model. Feed it the program's output, route its messages back, and
after each update take what it has for the world:

```silk
import ui_ghostty.view { TerminalView, TerminalMessage, Options, Outgoing }

pub struct Shell {
  view: TerminalView,
  pty: Pty,
}

pub union Message {
  Term { message: TerminalMessage },
  Output { bytes: Bytes },
}

// update
match move message {
  Message.Term { message } => run model.view.update(move message)
  Message.Output { bytes } => run model.view.write(bytes.asSlice())
}
let mut out = model.view.take()
while out.length() > 0 {
  match out.remove(0) {
    Outgoing.Send { bytes } => ...      // to the program: keys, paste, mouse, replies
    Outgoing.Resize { columns, rows } => ...  // to the PTY
    Outgoing.Copy { text } => ...       // to the clipboard (Shell.copy)
    Outgoing.Title { text } => ...      // the program set its title
  }
}

// view
h.map(|inner: &Document<TerminalMessage>| model.view.view(inner), |message| Message.Term { message: move message })
```

The view fills its parent, measures a cell of the font you give it (`Options.font`, a
monospace family id), and resizes the grid to fit. While a dragged selection scrolls past an
edge, `autoscrolling()` is true: send `TerminalMessage.Ticked` about every 50 ms meanwhile.

What a person can do, as in a terminal on the web:

- **Select.** Drag selects; two clicks select a word, three a line; Alt-drag selects a block.
  Dragging past the top or bottom scrolls. Typing clears it.
- **Copy and paste.** Cmd+C, Cmd+V and Cmd+A on macOS; Ctrl+Shift+C, Ctrl+Shift+V and
  Ctrl+Shift+A elsewhere, so plain Ctrl+C still interrupts. Pastes are bracketed when the
  program asks.
- **Scroll.** The wheel moves through the scrollback (an overlay scrollbar shows while you are
  in it); Shift+PageUp and Shift+PageDown do too. On the alternate screen without mouse
  tracking (`less`, `man`), the wheel sends arrow keys.
- **Type.** A hidden input under the cursor takes keys, IME composition and dead keys, so
  accented and CJK text work.
- **Mouse.** Programs that track the mouse (vim, htop, tmux) get presses, drags, motion and the
  wheel. Hold Shift to select instead.
- **Focus.** Programs that ask for focus reports get them; the cursor turns hollow without focus.

## The demo

```sh
python3 modules/ghostty/vt/scripts/prepare
silk run --manifest-path modules/ghostty/demo/silk.toml
```

It runs `$SHELL` (or the account's shell; `%COMSPEC%` on Windows) on a PTY, closes when the shell
exits, and follows the window's size. It reads the PTY every 16 ms while output flows or you
type, and four times a second when quiet, so an idle terminal costs almost nothing.

## In a browser

```sh
python3 modules/ghostty/vt/scripts/prepare --wasm
sh modules/ghostty/web/build.sh serve   # http://localhost:8019
```

A page has no processes, so [web/src/shell.silk](web/src/shell.silk) answers instead: `help`,
`colors`, `seq N`, `echo` and `clear`. The page is about 900 KB of WebAssembly with Ghostty in it.

## Tests

```sh
silk test --manifest-path modules/ghostty/vt/silk.toml --root src/tests.silk      # the wrapper
silk test --manifest-path modules/ghostty/tests/silk.toml --root src/tests.silk   # the component
silk test --manifest-path modules/ghostty/demo/silk.toml --root src/tests.silk    # real PTYs (Linux, macOS)
silk test --manifest-path modules/ghostty/web/silk.toml --root src/tests.silk     # the page's shell
```

The `ghostty` job in [UI CI](../../.github/workflows/ui.yml) prepares the library and runs these
on Linux, macOS and Windows.

## Credits

The wrapper and the demo's PTY started from an experiment in silk-lang/nonstd#275. Ghostty is
MIT licensed; its license is in [vt/LICENSE-ghostty](vt/LICENSE-ghostty).
