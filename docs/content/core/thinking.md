# Thinking in Silk UI

Knowing what a model, a message and a command are is one thing. Looking at an empty file and deciding what yours should be is another. This page is a method for that: six questions, asked in order, that take you from an idea to a program.

The running example is Focus, the app from the [tutorial](/core/tutorial/):

::demo focus-4

## 1. What does the app have to remember?

Write down everything on the screen that can differ from one moment to the next. For Focus:

- the tasks, and which are done
- the text in the field
- how many tasks are open
- which task is being worked on
- the time left in the session
- how many sessions each task has had
- the log of finished sessions
- which button the pointer is over

Now cross out what you do not need to store. Ask of each one:

| Question | If yes |
| --- | --- |
| Can it be computed from other things on the list? | Compute it in the view. Do not store it |
| Does the runtime already track it? Hover, focus, pressed, scroll position | Use a [style variant](/core/styling/). Do not store it |
| Is it the same forever? | It is a constant, not state |

The open count goes: it is computed from the tasks. Hover goes: the runtime knows. What remains is the model.

::source examples/src/focus/step4.silk "pub struct Focus"

Be strict here. Every stored value that could have been computed is a place where two parts of your app can disagree. A small model is the cheapest bug prevention you have.

**Make impossible states hard to write.** Focus stores the focused task as one id, and zero for none. It could have put a `focused: bool` on every task, and then two tasks could be focused at once and every update would have to prevent that. Shape the model so that the wrong states have no way to be written down.

## 2. What can happen?

List every event the app must react to. Not what the app does: what happens to it.

- the user typed in the field
- the user submitted the field
- the user clicked a checkbox
- the user clicked Focus
- the user clicked Stop
- a second passed
- the time of day arrived

Each one becomes a variant of `Message`, named in the past tense.

::source examples/src/focus/step4.silk "pub union Message"

Why past tense matters: a message named `StartTimer` invites you to think the sender decides what happens. A message named `ClickedFocus` leaves that decision where it belongs, in `update`. When the same click should later also clear the draft or write to the log, you change one branch of `update` and no view code.

Two checks for this list:

- **Two ways to do the same thing are one message.** Enter and the Add button both send `SubmittedDraft`.
- **Things the user did not do are messages too.** A tick and an answer from the clock sit in the same list as the clicks.

## 3. What does each event change?

Now write `update`, one branch per message. Each branch answers: given the model as it was, what is the model after this?

::source examples/src/focus/step4.silk "effect fn update"

Keep each branch about the model. If a branch wants to do something that is not "compute the next model", such as reading the time or saving a file, that is a sign you have found a command, and question 5 covers it.

When `update` grows, move branches into helper functions, the way `toggle` and `finish` are here. They are plain functions that take the model. No framework feature is involved.

## 4. What does the model look like?

Write `view` as if the model were a photograph you are describing. For each part of the screen, ask what in the model decides it.

| Part of the screen | Decided by |
| --- | --- |
| The text in the field | `model.draft` |
| The rows | `model.tasks`, one row each |
| A row's right side | Whether `model.focused` is this task, another task, or none |
| The open count | `open(model)` |
| The log | `model.log` |

Conditions in a view are ordinary `if` expressions that return nodes. To hide something, leave it out.

::source examples/src/focus/step4.silk "fn row"

Split the view into functions whenever a piece has a name: `row`, `logged`. A function with parameters is the unit of reuse. You almost never need more than that.

## 5. What does the app need from the outside world?

Go through the model and the messages and mark everything that touches something outside your program. For each, ask one question: **does it happen once because I asked, or does it keep happening while some condition holds?**

| The app needs | Once, or while? | So it is a |
| --- | --- | --- |
| The time of day when a session ends | Once | Command |
| A tick every second during a session | While a task is focused | Subscription |
| Saving the tasks after a change | Once per change | Command |
| Loading the tasks at startup | Once | Command returned from `init` |
| Key presses for a shortcut | While the app runs | Subscription |
| The window's size | While the app runs | Subscription |
| A server's reply | Once | Command |
| Messages from a socket | While connected | Subscription |

A **command** is returned from `update`, runs, and ends in exactly one message. A **subscription** is declared by `subscriptions(model)`, and sends messages for as long as the function keeps declaring it.

::source examples/src/focus/step4.silk "fn subscriptions"

The mistake to avoid is using a command for a "while" need: a `StartTimer` command paired with a `StopTimer` command. Then your code has to remember to stop it on every path. With a subscription there is nothing to remember, because the timer's existence is computed from the model like everything else.

For each command, name the **service** it needs, as narrowly as you can: `Clock`, and not `System`. A narrow service is easy to provide in a test.

## 6. Does any part need to be its own program?

Usually not. This question comes last on purpose.

Start with one model, one `Message` and view functions. That scales further than you would expect, because view functions already give you reuse and helper functions already keep `update` readable.

Reach for a [submodel](/core/composition/) when both of these are true:

- the part has state of its own that the rest of the app never looks at, and
- you use it in more than one place, or want to test it alone.

A stepper control used on five screens qualifies. A settings page used once does not: it is a view function and a few fields.

## The method on one page

1. **Remember:** list what changes, cross out what can be computed. That is the model.
2. **Happen:** list the events, in the past tense. That is `Message`.
3. **Change:** one branch per message. That is `update`.
4. **Look:** describe the model. That is `view`.
5. **Outside:** once is a command, while is a subscription.
6. **Split:** only when a part has private state and several uses.

## Which tool do I need?

| I want to | Use | Page |
| --- | --- | --- |
| Show something only sometimes | An `if` in the view | [Views](/core/views/) |
| Show a list | `h.each`, with `h.keyed` when rows can move | [Views](/core/views/) |
| Reuse a piece of UI | A function that returns a `Node` | [Views](/core/views/) |
| Change a look on hover, press or focus | A style variant | [Styling](/core/styling/) |
| Change a look because of my data | An `if` around a style | [Styling](/core/styling/) |
| React to a click or a key | A message | [Events](/core/events/) |
| Read what the user types | `h.onInput`, and a field in the model | [Events](/core/events/) |
| Fetch, save, read the time, roll a die | A command | [Commands](/core/commands/) |
| Tick, listen for keys, follow the window size | A subscription | [Subscriptions](/core/subscriptions/) |
| Have several pages with addresses | A route in the model | [Routing](/core/routing/) |
| Reuse a part that has its own state | A submodel | [Composition](/core/composition/) |
| Check that it works | Send messages, read the model | [Testing](/core/testing/) |

## Common mistakes

**Storing what you can compute.** A `count` next to the list it counts, a `isValid` next to the text it validates. Compute them in the view or in a function like `open`.

**Messages that give orders.** `SetDone { id, value }` makes the view decide the outcome. `ClickedToggle { id }` reports the click and lets `update` decide.

**Reaching for a command when the need is "while".** If you are writing a command to start something and another to stop it, you want a subscription.

**Doing work in `view`.** `view` runs after every update. Sorting a list of ten items there is fine. Parsing a file is not: do it once in `update` and store the result.

**Splitting too early.** Three submodels with outputs and inputs between them, for a screen that was one model with fifteen fields. Split when the private state and the reuse are both real.

**Hiding state from the model.** A value kept in a service or a global "to keep the model small" is state the view cannot see and a test cannot check. If the screen depends on it, it belongs in the model.
