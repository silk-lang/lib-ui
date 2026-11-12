# Tutorial: build Focus

In this tutorial you build one small app from an empty file: a task list with a focus timer and a log. It takes five steps, and each step adds one idea to a program that already runs. By the end you will have used every core concept, and seen how they depend on each other.

## What you are building

::demo focus-4

Add a task, press **Focus**, and let the fifteen seconds run out. That is the finished app.

| Step | You add | You learn |
| --- | --- | --- |
| 1 | A list you can check off | Model, message, `update`, `view` |
| 2 | A field to add tasks, and a count | Input, and what does not belong in the model |
| 3 | A countdown | Subscriptions |
| 4 | A log with the time of day | Commands and services |
| 5 | A test of a whole session | Why the rules pay off |

You do not need to have read anything else. If a step feels fast, each one links to the page that goes deeper.

> **Note:** Every listing here is a real file under `docs/examples/src/focus`, one per step, and each demo is that file running. Styling lives in a separate `look.silk` so the steps stay about behavior. [Styling](/core/styling/) covers it.

## Step 1: a list you can check off

::demo focus-1

Start with the question every Silk UI program starts with: **what does this app have to remember?** For a list of tasks, it is the tasks. That is the model.

::source examples/src/focus/step1.silk "pub struct Task"

::source examples/src/focus/step1.silk "pub struct Focus"

`nextId` is there so every task gets an id that is never reused. Rows need a stable identity, and a position in the list is not one: positions shift when a task is removed.

Next question: **what can happen?** So far, one thing. The user can click a checkbox.

::source examples/src/focus/step1.silk "pub union Message"

A message is named for what happened, in the past tense: `ClickedToggle`, and not `ToggleTask`. It reports. It does not command. The difference starts to matter in step 3, when messages arrive that no user sent.

Now the two functions. `update` says what each message does to the model:

::source examples/src/focus/step1.silk "effect fn update"

And `view` says what the model looks like:

::source examples/src/focus/step1.silk "fn view"

::source examples/src/focus/step1.silk "fn row"

Three things to notice in the view.

- `row` is an ordinary function. There is no component system to learn: a piece of UI is a function that returns a `Node`.
- `h.each` builds one node per task, and `h.keyed(task.id, ...)` tells the runtime which row is which, so a row keeps its identity when the list changes.
- `Message.ClickedToggle { id: task.id }` is a value, built while drawing. Nothing runs when the view is built. If the user clicks, the runtime hands that value to `update`.

The last piece is `init`, the model the program starts with:

::source examples/src/focus/step1.silk "effect fn init"

That is a complete program. Click a checkbox above: the message goes to `update`, `update` returns a model with that task flipped, and `view` draws it struck through.

**The whole file at this point:**

::source examples/src/focus/step1.silk

More on these: [Your first program](/core/first-program/), [Views](/core/views/).

## Step 2: adding tasks

::demo focus-2

A text field raises a question that trips people up in every framework: where does the text live while it is being typed? Here the answer is always the same. It is state, so it lives in the model.

::source examples/src/focus/step2.silk "pub struct Focus"

Two more things can happen now: the text changed, and the user asked to add it.

::source examples/src/focus/step2.silk "pub union Message"

The field shows `model.draft` and reports every change:

```silk
h.input(
  String.view(&model.draft),
  &[
    h.onInput(|value| Message.ChangedDraft { value: move value }),
    h.onEnter(Message.SubmittedDraft),
    ...
  ],
),
primary(h, "Add", Message.SubmittedDraft),
```

Notice that Enter and the Add button send the same message. `update` does not care how the user asked. It handles "the draft was submitted" once:

::source examples/src/focus/step2.silk "effect fn update"

After adding, `update` puts an empty draft in the model, and the field clears. You did not clear the field. You changed the model, and the field shows the model.

### What stays out of the model

The line under the list says how many tasks are open. It would be easy to add an `openCount` field and keep it up to date. Do not. The count can be computed from the tasks, so storing it would create two places that must agree, and one day they would not.

::source examples/src/focus/step2.silk "pub fn open"

The view calls `open(model)` when it draws. The rule: **the model holds the smallest state that everything else can be computed from.**

| Candidate | In the model? | Why |
| --- | --- | --- |
| The tasks | Yes | Nothing else can produce them |
| The draft text | Yes | It changes over time and nothing else knows it |
| How many are open | No | Computed from the tasks |
| Whether the draft is empty | No | Computed from the draft |
| Whether a row is hovered | No | The runtime tracks it. See [Styling](/core/styling/) |

More on this: [Events and input](/core/events/).

## Step 3: a countdown

::demo focus-3

Press Focus on a task and watch it count down from fifteen. When it reaches zero the session is counted on the task.

First the model. A session needs two facts: which task, and how much time is left.

::source examples/src/focus/step3.silk "pub struct Focus"

Then what can happen. The user can start and stop. And for the first time, something happens that the user did not do: a second passes.

::source examples/src/focus/step3.silk "pub union Message"

`update` treats `Ticked` like any other message:

::source examples/src/focus/step3.silk "effect fn update"

So where do ticks come from? You might expect a `startTimer()` call in the `ClickedFocus` branch and a `stopTimer()` in three other places. That is the kind of code that leaks timers. Silk UI turns it around. You write one function that says what the program wants to listen to, **given the model**:

::source examples/src/focus/step3.silk "fn subscriptions"

The runtime calls this after every update and compares the answer with the last one. When `focused` becomes non-zero, the answer starts to include a timer, so the runtime starts one. When `focused` goes back to zero, for any reason, the timer is gone from the answer, so the runtime stops it.

Look at the `Ticked` branch again. When the time runs out it sets `focused` to zero and does nothing else. It does not stop the timer. It cannot forget to.

The view follows the same pattern. Each row decides what to show on its right side from the model:

::source examples/src/focus/step3.silk "fn row"

The Focus buttons disappear during a session because the view does not include them while `model.focused != 0`. There is no "hide the buttons" step anywhere.

That is the idea worth taking from this step: **the timer, like the screen, is a function of the model.** You describe what should exist now, and the runtime makes it so.

More on this: [Subscriptions](/core/subscriptions/).

## Step 4: a log, and the time of day

::demo focus-4

When a session ends, a line appears under the list with the time it ended. That needs the time of day, and here you hit a wall on purpose: `update` cannot read the clock. Its signature allows it to allocate memory and nothing else, and the compiler holds it to that.

So `update` asks. It returns a **command** next to the model: a value that describes what it wants.

::source examples/src/focus/step4.silk "pub union Command"

In the `Ticked` branch, the end of a session now looks like this:

```silk
let title = run finish(&mut model, id)
return run Next.with(move model, Command.StampSession { title: move title })
```

The runtime takes the command and runs it. Running a command is the one place in the program that reaches outside:

::source examples/src/focus/step4.silk "impl CommandSet"

`execute` gets the time and returns a message with it. That message goes to `update` like every other one:

::source examples/src/focus/step4.silk "pub union Message"

```silk
Message.GotTime { title, minutes } => {
  run model.log.append(Entry { title: move title, minutes: minutes })
}
```

So a command is a round trip: `update` returns a request, the runtime does the work, and the answer comes back as a message. A command always ends in a message.

### Who has a clock?

`execute` does not call the system clock either. It calls `Clock.minutes()`, and `Clock` is a **service**: a small interface the program declares and somebody else implements.

::source examples/src/focus/step4.silk "pub service Clock"

Whoever starts the program provides it. In this page, the clock is three lines that call the browser's `Date`. In a native app it would read the system clock. In the test in the next step it always says 14:32.

| Piece | Knows about the outside world? |
| --- | --- |
| `update`, `view`, `subscriptions` | No. Plain functions of their arguments |
| `Command` | No. It is data that describes a wish |
| `execute` | Only through services it names |
| The service's implementation | Yes. This is the only code that differs per platform |

This is the same shape you would use to save the tasks to disk or to fetch them from a server: a `Store` service with `load` and `save`, a `Command.Save`, and a `Message.Loaded` that brings the answer back.

**The whole file at this point:**

::source examples/src/focus/step4.silk

More on this: [Commands](/core/commands/).

## Step 5: test a whole session

Everything so far had a purpose beyond tidiness. Because the model is the only state, messages are the only input, and the world is behind a service, you can run the whole app in a test, with no window, in milliseconds.

::source tests/src/focus.silk

Read `sessionBody` as a script of what a user would do:

1. `program.make` builds the same program the demo runs, and `app.start` runs `init`.
2. `app.send(...)` delivers a message as if the view had sent it. `drain` lets the loop run until it is idle.
3. `tick` moves time forward. Fifteen ticks are a whole session, and they take no real time at all.
4. `app.model.value` is the model. The test reads it directly.

And `Stopped` is the clock. The test provides it the same way the page provides its real one, so the log's time is known in advance: 872 minutes after midnight, which is 14:32.

Notice what the test checks that would be hard to check by hand: after the session, `app.nextDeadline()` is empty. The timer really did stop.

More on this: [Testing](/core/testing/).

## What you built, and what you used

| Concept | Where it showed up |
| --- | --- |
| Model | Tasks, draft, focused task, seconds left, log |
| Messages | Three from the view, one from a timer, one from a command |
| `update` | One `match` with every behavior of the app |
| `view` | Functions of the model, with `row` and `logged` as helpers |
| Derived data | `open(model)`, never stored |
| Subscription | A timer that exists exactly while a task is focused |
| Command | `StampSession`, a request returned from `update` |
| Service | `Clock`, real in the page and fixed in the test |
| Test | A full session with no screen |

The order you added things in is also a good order to design in: state first, then what can happen, then what it looks like, then how the world gets in. [Thinking in Silk UI](/core/thinking/) turns that into a method.

## Make it yours

Changes to try, from easy to hard. Each one is a small edit if you ask the same questions: what must be remembered, what can happen, what does it look like?

1. **Remove a task.** One new message and a button in `row`. What should happen if the removed task is the focused one?
2. **Pause and resume.** Does this need new state, or only a new message? What does `subscriptions` look at now?
3. **Session length.** Let the user choose between 15 and 25 minutes. Where does the choice live?
4. **Hide finished tasks.** A toggle and a filter in the view. Should the filtered list be stored?
5. **Remember the tasks.** Add a `Store` service with `load` and `save`. `init` can return a command too, so loading starts with the program.
6. **Put the filter in the address.** `/open` shows open tasks only. [Routing](/core/routing/) shows how the address becomes a message.
