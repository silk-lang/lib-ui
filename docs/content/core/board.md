# A real app: the board

The tutorial builds a small app slowly. This page goes the other way: it takes a finished app with the kind of interaction that is usually hard, and reads how it is put together. Nothing in it is new. It is the same model, messages, `update` and `view`, used on a bigger problem.

::demo board

Try all of it before reading on.

| Do this | What it exercises |
| --- | --- |
| Drag a card to another column | A captured pointer, and a view that follows the model |
| Focus a card with Tab, then press the arrow keys | Key handling, and focus that survives a move |
| Press a tag at the top | A filter that is computed and never stored |
| Add a card, remove one, then press Undo | History as plain data |

> **Note:** This is one file, `docs/examples/src/showcase/board.silk`. The page you are reading runs it on the DOM. [Your first window](/native/) runs the same file on the GPU.

## The model

Ask the first question of [Thinking in Silk UI](/core/thinking/): what does the app have to remember?

::source examples/src/showcase/board.silk "pub struct Card"

::source examples/src/showcase/board.silk "pub struct Board"

Three things are worth noticing.

- **The columns are not stored.** There is one list of cards, and each card says which column it is in. A column shows the cards that name it, in list order. Moving a card is taking it out of the list and putting it back somewhere else, so a card can never be in two columns or in none.
- **A drag is six numbers.** Which card, where the pointer went down, how far it has gone since, and where the card would land. There is no "drag object" with a life of its own.
- **Positions are not stored at all.** Cards all have one height, so where a card is drawn is arithmetic on its place in the column.

What is left out matters as much:

::source examples/src/showcase/board.silk "pub fn count"

The number in each column's heading, the cards a filter shows, and the height of the columns are all computed from the cards when the view draws.

## What can happen

::source examples/src/showcase/board.silk "pub union Message"

Read the list as a description of the app. A drag is `GrabbedCard`, some `MovedPointer`s, then `DroppedCard` or `LostPointer`. The keyboard is one message with a direction. Everything else is a click or typing.

## A drag, start to finish

Dragging is where UI code usually gets tangled: listeners added on press and removed on release, a ghost element, and state split between the DOM and your code. Here it is three branches of `update`.

**The press.** A card reports where the pointer went down:

```silk
h.onPointerDown(
  |event| Reply<Message>.Custom {
    message: Option<Message>.Some {
      value: Message.GrabbedCard { id: id, x: event.x, y: event.y },
    },
    stopPropagation: false,
    preventDefault: true,
  },
),
```

A handler that needs more than "send this message" returns a `Reply`. This one sends a message and also prevents the default action of a press, so the drag does not select the card's text.

`update` writes down where the drag started:

```silk
Message.GrabbedCard { id, x, y } => {
  model.fromIndex = place(&model, id, 0)
  ...
  model.dragging = id
  model.fromX = x
  model.fromY = y
  aim(&mut model)
}
```

**The moves.** The moves and the release have to arrive even when the pointer leaves the card, the board, or the window. So the board asks for the pointer while a card is being dragged:

```silk
if dragging {
  h.capturePointer()
} else {
  h.none()
},
h.onPointerMove(
  |event| if dragging {
    Reply<Message>.Emit { message: Message.MovedPointer { x: event.x, y: event.y } }
  } else {
    Reply<Message>.Pass
  },
),
```

This is the same idea as a [subscription](/core/subscriptions/): nothing starts or stops the capture. The view asks for it while `model.dragging` is set, and the runtime makes it so.

Each move updates how far the pointer has gone, and from that, where the card would land:

::source examples/src/showcase/board.silk "fn aim"

`aim` needs no measurements of the cards. A column is one `pitch` wide and a card one `STEP` tall, so the distance moved says how many columns across and how many places down.

**The release.** Dropping is the only step that changes the cards:

```silk
Message.DroppedCard => {
  let id = model.dragging
  model.dragging = 0
  if id != 0 && (model.overColumn != model.fromColumn || model.overIndex != model.fromIndex) {
    let column = model.overColumn
    let index = model.overIndex
    run remember(&mut model)
    run put(&mut model, id, column, index)
  }
}
```

If the press ends some other way, `LostPointer` sets `dragging` to zero and nothing else. The card is back where it was, because it never left the list.

## The view follows

There is no code that animates cards out of the way. Each card in a column is placed from the model:

::source examples/src/showcase/board.silk "fn resting"

While a card is dragged over a column, the cards from the landing place down are drawn one place lower. That is the whole "make room" effect. The `h.transition` line makes the change of `top` ease on the DOM. The dashed gap and the lifted card are two more view functions that read the same fields:

::source examples/src/showcase/board.silk "fn lifted"

## The keyboard

A focused card moves with the arrow keys. The handler turns a key into a message, and stops the page from scrolling:

::source examples/src/showcase/board.silk "fn arrow"

In `update`, a key move and a drop end in the same call, `put`. There is one way to move a card, and two ways to ask for it.

A card that changes column is a new node in a new parent, so it would lose the focus. The model remembers which card the keyboard moved, and the view asks for focus on it:

```silk
if model.held == id {
  h.takeFocus()
} else {
  h.none()
},
```

## Undo

Because the cards are plain data and change only in `update`, undo is short. Before each change, keep a copy:

::source examples/src/showcase/board.silk "effect fn remember"

And to undo, take the last copy back:

```silk
Message.ClickedUndo => {
  if model.past.length() != 0 {
    let last = model.past.length() - 1
    model.cards = model.past.remove(last)
  }
}
```

It works for drags, key moves, new cards and removed ones, and it will work for whatever you add next, because it does not know what the changes were.

## Testing a drag

A drag sounds like something you need a browser to test. It is three messages:

::source tests/src/board.silk

## The whole file

::source examples/src/showcase/board.silk

## Recap

- One list of cards is the only stored truth. Columns, counts, positions and the filter's result are computed.
- A drag is state in the model and three messages. The view asks to capture the pointer while the model says a drag is on.
- Moving cards out of the way is the view drawing the same model. Nothing is animated by hand.
- Undo is a list of earlier models' cards.

Next: [How it runs](/core/how-it-runs/) follows one message through the runtime.
