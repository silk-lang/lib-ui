# Subscriptions

Some messages come from neither the view nor a command: a timer ticks, a key is pressed while nothing has focus, the window changes size. A program gets those by **subscribing**.

> **Note:** A [command](/core/commands/) is for something that happens once because you asked. A subscription is for something that keeps happening while a condition holds. Step 3 of the [tutorial](/core/tutorial/) shows one driving a countdown.

## A stopwatch

::demo stopwatch

Start it and press Lap a few times. The quickest lap turns green and the slowest red.

::source examples/src/core/stopwatch.silk

## Subscriptions are a function of the model

::source examples/src/core/stopwatch.silk "fn subscriptions"

There is no `startTimer` and no `stopTimer`. The program says what it is listening to *for this model*. The runtime asks again after every update, starts what is new, and stops what is gone.

So the timer cannot leak. It runs exactly while `model.running` is true, because that is the only thing the code says.

`subs.every(1, 0.1, ...)` asks for a message every 0.1 seconds. The first argument is a **key**: a number, unique in this program, that tells the runtime which subscription is which from one update to the next.

## The subscriptions there are

| Call | Sends a message |
| --- | --- |
| `subs.every(key, seconds, \|time\| ...)` | Every `seconds` seconds |
| `subs.animationFrame(key, \|time\| ...)` | Once per display frame, for motion the model drives |
| `subs.keyBinding(key, "k", modifiers, \|\| ...)` | When a key goes down, wherever focus is |
| `subs.resize(key, \|width, height\| ...)` | When the window or page changes size |
| `subs.location(key, \|path\| ...)` | When the address changes. See [Routing](/core/routing/) |
| `subs.port(key, "name", \|text\| ...)` | When the host posts text to a named port |

A native app has a few more, for its menu bar, file dialogs and window: see [The shell](/native/shell/).

## Keyboard shortcuts

```silk
import ui_app.keys { MOD_CONTROL }

fn subscriptions(model: &Editor, subs: &mut Subscriptions<Message>) -> () {
  subs.keyBinding(1, "s", MOD_CONTROL, || Message.PressedSave)
  subs.keyBinding(2, "Escape", 0, || Message.PressedEscape)
}
```

The key is named as the web names it: `"s"`, `"Escape"`, `"ArrowUp"`. The modifiers must match exactly.

While a text field has focus, plain keys belong to the field, so only Escape and chords with Control, Alt or Meta fire. A handler in the view that stops the key wins over a binding.

## Ports

A port is how the outside world sends your program a message at a time of its own choosing: a response arrived, a worker finished, a socket received something.

```silk
subs.port(1, "news", |text| Message.GotNews { text: move text })
```

The host posts a string to the port's name, and the program gets a message. In a page that is `page.post("news", text)` from JavaScript. In a native app a worker thread posts through a `Poster`. [Background work](/native/background-work/) shows the native side from start to end.

## Recap

- `subscriptions` is a function of the model. It runs after every update.
- The runtime starts what the function newly asks for and stops what it no longer asks for. There is no cleanup to write.
- Timers, frames, keys, window size and the address are all subscriptions.
- A port brings in messages from code outside the program.

Next: [Routing](/core/routing/).
