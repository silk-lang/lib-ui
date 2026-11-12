# Testing

A Silk UI program is a model, messages, and functions between them. A test needs no window, no browser and no mocks of the screen. It sends messages and looks at the model.

All the tests on this page are the real tests of the examples in these docs. They run on every change to the repository.

```sh
silk test --manifest-path docs/tests/silk.toml --root src/tests.silk
```

## Messages in, model out

::source tests/src/core.silk "effect fn counterBody"

::source tests/src/core.silk "test effect fn theCounterCounts"

Step by step:

1. `program.make` makes the first model and a runtime for it.
2. `app.start` renders the first view. `Html.make()` is a page that exists only as text in memory, which is all a test needs.
3. `app.send(message)` queues a message, exactly as a click would.
4. `drain` runs the program until it has nothing left to do: every queued message, the commands they return, and the messages those end in.
5. `app.model.value` is the model.

The test function itself, the one marked `test`, only provides what the body needs. Here that is memory.

## Commands

A program with commands asks for services. A test provides ones it controls, as [Commands](/core/commands/) showed for the dice:

::source tests/src/core.silk "test effect fn aRollAsksTheDie"

Because `drain` also runs the commands, the test above checks the whole round trip: the click, the command, the service, the message that came back, and the model after it.

## Time

A test does not wait for timers. It moves the clock.

::source tests/src/core.silk "effect fn stopwatchBody"

`tick(&mut app, &mut page, 0.15, false)` says "it is now 0.15 seconds". Timers that are due fire. `app.nextDeadline()` is when the next timer is due, or nothing when no timer is running.

## Clicking and typing for real

The tests above send messages directly. That is fast and covers `update`, but it skips the view: nothing checks that the button is there, or that clicking it sends the right message.

The harness closes that gap. It runs the program on the real UI tree, with real layout, and feeds it pointer and keyboard input the way a window does.

::source tests/src/core.silk "effect fn todoBody"

- `click(..., "draft")` finds a node by its test id, its label or its text, and clicks its middle. It returns false when there is no such node.
- `typeText` types into whatever has focus.
- `press` presses a key.

If the field were covered by another node, or the button were off screen, the click would miss and the test would fail. That is the kind of bug a message-only test cannot find.

| From `ui_app.harness` | Does |
| --- | --- |
| `click`, `clickRole`, `clickAt` | Clicks a node by name, by role and name, or at a point |
| `typeText`, `press` | Types text, presses a key |
| `hover`, `drag`, `wheel` | Moves, drags and scrolls |
| `snapshot` | The whole tree as text, to compare with a saved one |

## Which kind to write

| Test | Good for |
| --- | --- |
| Messages in, model out | The logic of `update`. Write many of these |
| With fake services | Commands and what the program does with their answers |
| With the harness | The few paths where the view matters: forms, keyboard, focus |

Native apps add one more tool, a shell that writes down what was asked of it: see [Testing without a window](/native/testing/).
