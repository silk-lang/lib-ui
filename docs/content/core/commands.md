# Commands

`update` cannot touch the outside world. So how does a program read a file, ask a server, or roll a die? It returns a **command**: a value that says what it wants done. The runtime does it, and the result comes back as a message.

> **Note:** In the loop, commands are how `update` reaches the outside world, once, and gets an answer. For things that keep happening, see [Subscriptions](/core/subscriptions/). Step 4 of the [tutorial](/core/tutorial/) adds a command to a growing app.

## Dice

::demo dice

Press Roll a few times, then Roll 50. The bars count how often each face came up, so the die's odds draw themselves.

::source examples/src/core/dice.silk

## Asking

::source examples/src/core/dice.silk "effect fn update"

When Roll is clicked, `update` does not roll anything. It counts one more roll it is waiting for, and returns the model with a command next to it:

```silk
return run Next.with(move model, Command.Roll { sides: 6 })
```

A command is plain data, like a message. `update` is still a function you can call with a model and a message and compare the answer.

| To return | Write |
| --- | --- |
| A model and nothing else | `Next.of(model)` |
| A model and one command | `run Next.with(model, command)` |
| A model and several commands | `Next.batch(model, commands)` |

Roll 50 is the last row: one update returns fifty commands, and fifty `Rolled` messages come back, one at a time. Nothing else in the program changes for it.

`init` returns the same thing, so a program can start with commands: load the saved state, ask for the first page of data.

## Doing

::source examples/src/core/dice.silk "impl CommandSet"

`execute` is where a command becomes work. It runs after `update` returns. It does the work, and it returns the message that says how the work ended. That message goes to `update` like any other.

This is the only part of a program that reaches outside, and it is small on purpose.

A command always ends in a message, so a command that can fail says so in its message. A program that loads a file has `LoadedFile { text }` and `FailedToLoadFile`, and `update` handles both.

## Services

::source examples/src/core/dice.silk "pub service Random"

`execute` does not call a random number generator directly. It asks for a **service**: `Random`. The signature of `execute` lists what it needs after the `?`:

```silk
effect fn execute(self: Self) -> Message
  ! OutOfMemoryError
  ? &mut Random
```

The program says what it needs and not where it comes from. Whoever starts the program provides it, once:

| Where the program runs | Who provides `Random` |
| --- | --- |
| In this page | A struct that calls the browser's `Math.random` |
| In a native app | A struct with a generator of its own |
| In a test | A struct that always answers 4 |

That last line is the point. Here is the test for this program. It decides what the die says, then checks what the program made of one roll and of fifty.

::source tests/src/core.silk "struct Loaded"

::source tests/src/core.silk "impl Random for Loaded"

::source tests/src/core.silk "effect fn diceBody"

::source tests/src/core.silk "test effect fn aRollAsksTheDie"

`Effect.provideMut<Random>(&mut die)` is the line that hands the program its service. [In the browser](/core/browser/) shows the same line with a real die.

## Work that takes a while

A command runs to its end before the next message is handled, so a command should be quick. For work that takes a while, such as a network request or a long computation, the command *starts* the work and returns. The result arrives later through a **port**, which is a kind of [subscription](/core/subscriptions/).

[Background work](/native/background-work/) builds a whole program around that.

## Recap

- `update` returns a command as a value. The runtime runs it afterward.
- A command always ends in one message, which goes to `update`.
- `execute` reaches the world only through services it names. Whoever starts the program provides them.
- A different service in a test is all it takes to control the outside world.

Next: [Subscriptions](/core/subscriptions/).
