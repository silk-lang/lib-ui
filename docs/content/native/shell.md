# The shell

A desktop app does more than draw in a rectangle. It has a title, a menu bar, open and save dialogs, a clipboard, and a close button that sometimes must ask first. Silk UI calls all of that the **shell**.

This page reads one app that uses every part of it.

## Pad

::shot native-pad "Pad. Where the browser has WebGPU it runs here, and you can type in it. The page draws the title bar a desktop would. A page has no menu bar and no files, so those parts need the desktop."

Pad edits one note. It has a menu bar, opens and saves files through the system's dialogs, copies to the clipboard, follows the system's dark appearance, and asks before it closes with unsaved work.

::source examples/src/native/pad.silk

## Asking the shell: commands

The shell is a [service](/core/commands/), like any other thing a program needs from outside. A command asks it for something:

::source examples/src/native/pad.silk "impl CommandSet"

| Call | Does |
| --- | --- |
| `Shell.setTitle(text)` | Sets the window's title |
| `Shell.setSize(width, height)` | Sets the size of the window's content |
| `Shell.minimize()`, `Shell.toggleFullScreen()` | What they say |
| `Shell.setMenu(menu)` | Installs the menu bar |
| `Shell.openFile(request, dialog)` | Opens a dialog that chooses files to open |
| `Shell.saveFile(request, dialog)` | Opens a dialog that chooses where to save |
| `Shell.copy(text)`, `Shell.paste()` | Writes and reads the clipboard |
| `Shell.dark()` | Whether the system asks for a dark appearance |
| `Shell.quit()` | Closes the window and ends the program |

## Hearing from the shell: subscriptions

What the window has to say comes back the way everything comes back: as messages, through [subscriptions](/core/subscriptions/).

::source examples/src/native/pad.silk "fn subscriptions"

| Subscription | Sends a message when |
| --- | --- |
| `subs.menuAction` | An item of the menu is chosen |
| `subs.files` | A file dialog closes |
| `subs.appearance` | The system switches between light and dark |
| `subs.windowFocus` | The window becomes the one the user works in, or stops being it |
| `subs.closeRequested` | The user asks to close the window or quit |

## The menu bar

::source examples/src/native/pad.silk "effect fn menu"

A menu is built in order: `begin` opens a menu, `end` closes it, and a `begin` inside another makes a submenu.

- `menu.action(title, action, key, modifiers)` is an item of your own. `action` is a number you choose, and `subs.menuAction` hands it back when the item is chosen.
- `commandKey()` is Command on macOS and Control elsewhere, so `"s"` with `commandKey()` is the shortcut people expect on each system.
- `menu.standard(StandardItem.Quit)` is an item the system implements itself: About, Hide, Quit, Minimize, Close Window and the like. A system that has no such item leaves it out.

On macOS the first menu is the app's own, and the system titles it with the app's name.

## File dialogs

A dialog is open for as long as the user likes, so it cannot be a command that waits. It is a round trip in two halves.

The command opens the dialog and ends:

```silk
run Shell.openFile(OPENING, FileDialog.file("Open a note", "txt,md"))
```

Later, when the dialog closes, `subs.files` sends the request number and the chosen paths:

```silk
subs.files(2, |request, paths| Message.ClosedDialog { request: request, paths: move paths })
```

`update` looks at the request to know which dialog it was, and at the paths to know what was chosen. No paths means the dialog was cancelled.

| Dialog | Chooses |
| --- | --- |
| `FileDialog.file(title, extensions)` | One file |
| `FileDialog.files(title, extensions)` | Any number of files |
| `FileDialog.directory(title)` | A directory |
| `FileDialog.saving(title, name, extensions)` | Where to save, with a first file name |

## Closing

::shot native-pad-closing "The close button was pressed while the note had unsaved work. Where the browser has WebGPU this is Pad again, with a title bar the page draws: type something, then press its close button."

Without `subs.closeRequested`, the close button closes the window. With it, the program decides:

```silk
Message.RequestedClose => {
  if !model.dirty {
    return run Next.with(move model, Command.Quit)
  }
  model.asking = true
}
```

The window stays open until a command calls `Shell.quit()`. Pad quits at once when there is nothing to lose, and otherwise shows a bar that asks.

## Files are a service too

Pad reads and writes files, and `update` cannot. So the program declares what it needs:

::source examples/src/native/pad.silk "pub service Disk"

The app provides the real thing.

## The entry point

::source examples/apps/pad/src/main.silk

Compare it with [the first window](/native/). Two things were added:

- `window.shell()` is the shell of this window. `Effect.provideMut<Shell>(&mut shell)` hands it to the program.
- `Files` implements `Disk` with the machine's file system, and is handed over the same way.

The last type argument of `show` lists what the program's commands need: `&mut Shell | &mut Disk | &mut Allocator`.

Because the program only ever sees the two services, it can be run with other ones. [Testing without a window](/native/testing/) does exactly that with this app.
