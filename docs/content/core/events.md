# Events and input

The view describes the screen, and it also says which message each thing the user does turns into. This page builds a to-do list: a text field, a list that changes, and buttons in every row.

> **Note:** In the loop, this is the step from the screen back to `update`: what the user does becomes a message. It is steps 1 and 2 of the [tutorial](/core/tutorial/).

## A to-do list

::demo todo

Type something and press Enter. Check an item, hide the done ones, remove one.

::source examples/src/core/todo.silk

## Messages that carry data

::source examples/src/core/todo.silk "pub union Message"

A message can carry what happened *to*. `ClickedToggle` carries the id of the item, and `ChangedDraft` carries the new text of the field.

In the view, each row builds its own message:

```silk
h.onClick(Message.ClickedToggle { id: item.id })
```

## Text fields

```silk
h.input(
  String.view(&model.draft),
  &[
    h.placeholder("What needs doing?"),
    h.onInput(|value| Message.ChangedDraft { value: move value }),
    h.onEnter(Message.SubmittedDraft),
  ],
)
```

A field shows the value the view gives it, here `model.draft`. When the user types, `h.onInput` turns the field's new text into a message, `update` stores it in the model, and the view gives it back. The model always knows what is in the field.

That round trip is what lets `update` empty the field after an item is added: it sets `model.draft` to an empty string, and the field follows.

`h.onEnter` sends a message when Enter is pressed in the field.

> **Note:** Caret movement, selection, copy and paste, and input methods are handled by the field itself. Your program only hears what the value became.

## Lists that change

::source examples/src/core/todo.silk "fn view"

`h.keyed(item.id, node)` gives a row an identity. Without keys, removing the first of three rows would look like "the first two rows changed their text and the third one went away". With keys, the runtime knows which row left, and the others keep their nodes, their focus and their scroll position.

Use a key that belongs to the item and never changes, such as an id. The index in the list is not a key.

## The events there are

Most programs need only a few.

| Attribute | Sends a message when |
| --- | --- |
| `h.onClick(message)` | The node is clicked, or a focused button gets Enter or Space |
| `h.onDoubleClick(message)` | It is double clicked |
| `h.onInput(\|value\| ...)` | A field's value changes |
| `h.onEnter(message)` | Enter is pressed in the node |
| `h.onFocus(message)`, `h.onBlur(message)` | The node gets or loses focus |
| `h.onPointerEnter(message)`, `h.onPointerLeave(message)` | The pointer comes onto or leaves the node |

The ones in the next table hand you the event itself, and you answer with a `Reply`.

| Attribute | Hears |
| --- | --- |
| `h.onKeyDown`, `h.onKeyUp` | A key. `event.key` is its name, `event.modifiers` the keys held with it |
| `h.onPointerDown`, `h.onPointerMove`, `h.onPointerUp` | The pointer. `event.x` and `event.y` are its position |
| `h.onWheel` | The wheel. `event.deltaX` and `event.deltaY` |
| `h.onScroll(\|x, y\| ...)` | A scroll container's new offsets |
| `h.onLayout(\|box\| ...)` | The node's size and position, when they change |

## Bubbling, and stopping it

Events travel as they do in a web page: from the node they happened on, up through its parents. A click on the text of a button reaches the button's `onClick`.

A handler that takes the event answers with a `Reply`, which says two things at once: which message to send, if any, and whether the event goes on.

```silk
h.onKeyDown(
  |event| if String.view(&event.key) == "Escape" {
    Reply<Message>.EmitAndStop { message: Message.PressedEscape }
  } else {
    Reply<Message>.Pass
  },
)
```

| Reply | A message | Parents see the event |
| --- | --- | --- |
| `Emit { message }` | Yes | Yes |
| `EmitAndStop { message }` | Yes | No |
| `Pass` | No | Yes |
| `Stop` | No | No |
| `Prevent` | No | Yes, and the default action is skipped |

`Prevent` is `preventDefault`: a wheel does not scroll, a press does not move focus, a key does not type.

## Keys that work everywhere

A shortcut that should work wherever focus is does not belong on a node. It is a [subscription](/core/subscriptions/): `subs.keyBinding`.

## Recap

- An event attribute pairs something the user does with the message to send.
- A message is a value built while drawing. Nothing runs until the event happens.
- Text being typed is state, so it lives in the model: `h.onInput` reports each change.
- Name messages for what happened, and let `update` decide what it means.

Next: [Commands](/core/commands/).
