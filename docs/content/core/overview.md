# Silk UI at a glance

Silk UI is a framework for building apps out of three plain things: a value that holds your state, a function that changes it, and a function that draws it. This page shows the whole picture once, on one small app, before the rest of the guide takes the parts one at a time.

## An app that uses every idea

::demo focus-4

This is Focus, a task list with a timer. Try it: add a task, press **Focus**, and wait fifteen seconds. The countdown runs, the session is counted on the task, and a line with the time of day appears in the log.

It is about 280 lines, and it contains every concept in this guide. The [tutorial](/core/tutorial/) builds it from an empty file. Here we only look at how its parts fit.

## The whole idea

Most UI code is hard because state is scattered: a little in each widget, a little in callbacks, a little in timers that are still running somewhere. Silk UI removes the scattering with three decisions.

1. **All state lives in one value, the model.** If it is not in the model, the app does not remember it.
2. **Everything that happens is a message.** A click, a key, a timer tick and an answer from the outside world are all values of one type.
3. **The screen is computed from the model.** You never change what is on screen. You change the model, and the screen follows.

That gives a loop, and the loop is the entire runtime:

```text title="The loop"
      ┌───────────── view(model) ─────────────▶  the screen
      │                                               │
    model                                      clicks and keys
      ▲                                               │
      │                                               ▼
      └────── update(model, message) ◀───────────  a message
                      │                               ▲
                      │ can also return               │
                      ▼                               │
                  commands ──▶  the outside world  ───┤  answers
                                files, network,       │
              subscriptions ──▶ the clock          ───┘  events
```

Read it from the model. `view` turns the model into a screen. The user does something, and that becomes a message. `update` takes the model and the message and returns the next model. Then `view` runs again.

The lower half is how the outside world gets in. Your code never reaches out on its own. It returns a **command** when it wants something done once, and it declares a **subscription** when it wants to keep hearing about something. Both answer with messages, so they join the same loop.

## The cast

These are all the concepts there are. The last column says what each one is in Focus, and each name links to its page.

| Concept | What it is | In Focus |
| --- | --- | --- |
| [Model](/core/first-program/) | One value with all the state | The tasks, the draft, which task is focused, the seconds left, the log |
| [Message](/core/events/) | Something that happened | `ClickedFocus`, `Ticked`, `GotTime` |
| [`update`](/core/how-it-runs/) | Model and message in, next model out | Starts a session, counts down, ends it |
| [`view`](/core/views/) | Model in, description of the screen out | The field, the rows, the log |
| [Command](/core/commands/) | A request to the outside world, as a value | `StampSession`: what time is it? |
| [Service](/core/commands/) | Who actually does a command's work | `Clock`, provided by the page |
| [Subscription](/core/subscriptions/) | Something to listen to while the model says so | A tick every second, only during a session |
| [Location](/core/routing/) | The address, treated as one more input | Not used |
| [Submodel](/core/composition/) | A smaller program inside a bigger one | Not used |
| [Host](/core/browser/) | What puts the view on a real screen | This page. In a [native app](/native/), a window |

## One session, traced

Here is everything that happens when you press Focus and wait. Each line is one trip around the loop.

1. You click **Focus** on a task. The button was built with `h.onClick(Message.ClickedFocus { id })`, so the runtime now holds that message.
2. The runtime calls `update`. It sets `focused` to the task's id and `secondsLeft` to 15, and returns the model.
3. The runtime calls `view`. The row of the focused task now shows `0:15` and a Stop button, and the other rows lose their Focus buttons. Nobody hid those buttons: they are missing from the new description, so they are removed.
4. The runtime calls `subscriptions`. With a task focused, the function asks for a tick every second. The runtime starts a timer. Nobody called "start timer": the model says a session is running, so a timer exists.
5. One second later the timer sends `Message.Ticked`. `update` subtracts one. `view` shows `0:14`. This repeats.
6. On the fifteenth tick, `update` sees zero. It clears `focused`, adds one to the task's sessions, and returns the model **together with a command**: `StampSession`. It cannot read the clock itself, so it asks.
7. `subscriptions` runs again. Nothing is focused, so it asks for nothing, and the runtime stops the timer.
8. The runtime runs the command. Its code asks the `Clock` service for the time, and wraps the answer in a message: `GotTime { title, minutes }`.
9. `update` receives `GotTime` and appends a line to the log. `view` shows it.

Steps 2, 5, 6 and 9 are the same function. That is the point of the design. To know everything Focus can do, you read one `match` in `update`:

::source examples/src/focus/step4.silk "effect fn update"

## Three rules that follow

- **`view` cannot change anything.** It receives the model by reference and returns a description. It runs after every update, so it must be cheap and must not remember things.
- **`update` cannot touch the world.** No files, no network, no clock, no randomness. The compiler enforces it. When `update` needs the world, it returns a command.
- **The world only comes back as messages.** A command's answer and a subscription's event both arrive in `update`, like a click does.

What you get for following them:

- **Tests without a screen.** Send messages, read the model. The [test of Focus](/core/tutorial/) runs a whole session in a few milliseconds, with a clock that always says 14:32.
- **One program, several places.** Nothing in Focus knows about a browser or a window. This page runs it on the DOM. A native app runs the same file in a window.
- **Bugs you can replay.** State changes only in `update` and only because of a message, so a list of messages is a complete recording of a session. The [devtools](/native/devtools/) show that list live.

## If you come from another framework

| You know | In Silk UI |
| --- | --- |
| React `useState`, Vue `ref`, Svelte `$state` | A field of the model |
| An `onClick` handler that sets state | `h.onClick(Message.X)`, and a branch of `update` |
| A component that only takes props | A function that returns a `Node` |
| A component with its own state | Usually still a function, with its state in the parent's model. Sometimes a [submodel](/core/composition/) |
| `useEffect` that fetches or saves | A [command](/core/commands/) |
| `useEffect` that subscribes and cleans up | A [subscription](/core/subscriptions/). There is no cleanup to write |
| A router | The [location](/core/routing/) arrives as a message, and you keep a route in the model |
| Redux, the Elm Architecture | This is that architecture. `update` is the reducer, and commands are its effects |

The biggest difference from component frameworks: there is no local state to lift and no question of which component owns what. The model owns everything, and views are functions of it.

## Where to go next

- **Read code first?** [Your first program](/core/first-program/) is the smallest complete program, explained line by line.
- **Learn by building?** The [tutorial](/core/tutorial/) writes Focus in five steps, each one running in the page.
- **Want to see something bigger?** [A real app: the board](/core/board/) reads a task board with drag and drop, keyboard moves and undo.
- **Starting your own app?** [Thinking in Silk UI](/core/thinking/) is a method for going from an idea to a model, messages and a view.
- **Looking something up?** The Concepts pages each cover one row of the table above.
