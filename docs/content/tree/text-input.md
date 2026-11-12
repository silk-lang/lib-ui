# Text input and focus

Editing text is the hardest part of any UI toolkit, and the tree does it for you: the caret, selection with the pointer and the keyboard, word and line movement, copy and paste, undo, scrolling to keep the caret in view, and input methods for languages that compose their text.

The client's part is small. It hears what the value became.

## A greeting

::shot tree-field "The field. Where the browser has WebGPU it is running, so click it and type. The caret, the focus border, selection and the scrolled text are the tree's work."

::source examples/src/tree/field.silk

## A field

```silk
let name = run tree.input(&[css.width(px(240.0)), css.padding(px(8.0)), ...])
run tree.setAttribute(name, Attribute.Placeholder { value: run String.copy("Ada") })
run tree.listen(name, &[EventKind.Input])
```

An input is a node like the others: it has a style, looks for focus, and attributes.

| Attribute | Effect |
| --- | --- |
| `Placeholder { value }` | The text an empty field shows |
| `Multiline { value: true }` | Several lines: Enter breaks the line, text wraps, the box scrolls |
| `ReadOnly { value: true }` | The text can be selected and copied, not changed |
| `Disabled { value: true }` | No focus and no input |

`css.caretColor`, `css.selectionColor` and `css.placeholderColor` style the parts of a field that are not its text.

## Hearing the value

::source examples/src/tree/field.silk "pub effect fn pump"

Each change queues one `Event.Input` record. Its `change` has the field's whole new value, what kind of change it was, and where the selection is afterwards.

```silk
Event.Input { change } => {
  change.value        // the text now
  change.inputType    // InsertText, DeleteBackward, InsertFromPaste, ...
  change.selection    // the caret or the selected range
}
```

## Setting the value

`tree.setText(field, value)` sets a field's text. Setting the value it already has changes nothing, caret included. So a client that keeps the value in its own state can set it back after every change, and stays in control of what the field holds. Silk UI's `h.input` works that way.

## Focus

| Call | Does |
| --- | --- |
| `tree.focus(node)` | Gives a node focus |
| `tree.blur()` | Takes focus away |
| `tree.focused()` | The node that has it, if any |

The pointer and the Tab key move focus too. Inputs are in the tab order from the start. Any other node joins with `Attribute.TabIndex { value: 0 }`, and then Enter and Space click it, which is how the counter on the [Events](/tree/events/) page made its box a button.

`Attribute.FocusTrap { value: true }` keeps Tab inside a node, as a dialog wants.

A node has two looks for focus. `StyleState.Focus` applies whenever it has focus. `StyleState.FocusVisible` applies only when focus came from the keyboard, which is when a focus ring helps.

## Selection

```silk
run tree.select(field, Selection.range(0, 5))
let selection = tree.selection(field)      // an Option<Selection>
let caret = run tree.caretRect(field)      // where the caret is drawn
```

A selection has an `anchor` and a `focus`, so it keeps its direction. `selection.start()` and `selection.end()` read it in order.

## Scrolling

A box with `css.overflowY(Overflow.Auto)` scrolls when its content is taller than it is. The wheel, the keyboard and a drag of the scrollbar all work without code.

| Call | Does |
| --- | --- |
| `tree.scrollTo(node, x, y)` | Scrolls a box to an offset |
| `tree.scrollIntoView(node)` | Scrolls whatever is needed to show a node |
| `tree.scrollOffset(node)` | Where a box is scrolled to |

A node that listens for `EventKind.Scroll` gets a record when it scrolls.

## What the frame tells the host

A field needs things from whoever owns the window. The tree does not call the host. It says what it needs in the frame it returns.

| Field of the frame | For the host to |
| --- | --- |
| `cursor` | Show the right pointer: an arrow, a text beam, a hand |
| `ime` | Tell the system where composed text goes |
| `wakeAt` | Ask for another frame then, so the caret blinks |
| `again` | Ask for another frame right away |

Clipboard reads and writes arrive as `tree.requests()`: the tree asks, and the host answers with the system's clipboard. The window host on the next page does all of this.
