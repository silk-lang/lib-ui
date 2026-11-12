# Events

The tree does not call you. You feed it input, and it queues **records** of what happened for the nodes that asked. You take the records when it suits you and answer them by changing the tree.

This page builds a counter that way.

## A counter

::shot tree-clicker "The counter. Where the browser has WebGPU it is running: click it, or focus it and press Enter."

::source examples/src/tree/clicker.silk

## Listening

```silk
run tree.listen(button, &[EventKind.Click])
```

Nothing is recorded for a node until it listens. The list replaces what the node listened for before, and an empty list stops it.

## Input in

Input is plain data. A window host makes it from what the system reports. A test, or the tool that drew the pictures on this page, makes it by hand:

```silk
run tree.dispatch(Input.moveTo(200.0, 80.0))
run tree.dispatch(Input.press(200.0, 80.0))
run tree.dispatch(Input.release(200.0, 80.0))
```

| Constructor | What it is |
| --- | --- |
| `Input.moveTo(x, y)` | The pointer moved |
| `Input.press(x, y)`, `Input.release(x, y)` | The primary button went down, came up |
| `Input.wheel(x, y, deltaX, deltaY)` | The wheel turned |
| `Input.key(name)` | A key went down: `"Enter"`, `"Tab"`, `"a"` |
| `Input.text(value)` | Text was typed, for the focused field |

Positions are CSS pixels in the viewport. The tree hit tests against the last frame, so ask for a frame before the first input.

The tree does a lot with input before you see any of it. A press focuses what it lands on. A press and a release on the same node become a click. Tab moves focus. Enter and Space click a focused button. The wheel scrolls the nearest scrollable box.

## Records out

::source examples/src/tree/clicker.silk "pub effect fn pump"

`tree.events()` takes everything queued so far, oldest first, and empties the queue.

A record has three parts:

| Field | What it is |
| --- | --- |
| `target` | The node the event happened on |
| `path` | The nodes from the root down to the target |
| `event` | What happened: a union with one variant per kind of event |

Each variant carries only what that event has:

```silk
match &record.event {
  Event.Click { pointer, count, .. } => { ... }      // where, and single or double
  Event.KeyDown { key, .. } => { ... }               // which key
  Event.Input { change } => { ... }                  // a field's new value
  _ => {}
}
```

## Bubbling

Events bubble as in the DOM: a click on the text inside a button is a click on the button too. The record's `target` is the deepest node, and `record.hits(node)` asks the useful question: does this event reach a listener on `node`?

```silk
if all[i].hits(self.button.id()) { ... }
```

When several nodes on the path listen and you want the DOM's exact order, with capture, target and bubble phases and a way to stop, walk the record with `Propagation`:

```silk
let mut walk = Propagation.over(&record)
let mut next = walk.next()
while let Option<Step>.Some { value: step } = next {
  // step.node and step.phase. Call walk.stopPropagation() to end the walk.
  next = walk.next()
}
```

## Preventing a default

Some input has a default action: a press moves focus, a wheel scrolls, a key types. There are two ways to turn one off.

Declare it on a node, when the answer is always the same:

```silk
run tree.prevent(toolbarButton, &[DefaultAction.Focus])
```

Or decide per event, when it depends on what happened. `begin` dispatches the event and stops before the default action, you look at the records, and `finish` says whether it was prevented:

```silk
let pending = run tree.begin(input)
let records = run tree.events()
// ... decide ...
run tree.finish(pending, prevented)
```

## Dragging

A press captures the pointer: the moves and the release that follow go to the pressed node even when the pointer leaves it. `tree.setPointerCapture(node)`, called from a pointer down, hands that capture to another node, as the DOM call of the same name does.

## Answering

The client answers an event by changing the tree: `tree.setText(label, "Clicked 3 times")`. The next frame lays out and paints what that changed, and nothing else.

That loop is all there is: input in, records out, changes in, a frame. A framework over the tree, [Silk UI](/core/) included, is a way of writing that loop once.
