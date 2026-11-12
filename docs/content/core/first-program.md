# Your first program

This page reads one small program from top to bottom: a counter. It is the smallest thing that is still a whole Silk UI program, and everything bigger has the same four parts.

## The program

::demo counter

::source src/core/counter.silk

## The model

::source src/core/counter.silk "pub struct Counter"

The **model** is everything the program remembers. Here it is one number. There is no other state anywhere: no fields on components, no hooks, no stores. If the screen shows it, it is in the model or computed from it.

## Messages

::source src/core/counter.silk "pub union Message"

A **message** says that something happened. Name them as facts, in the past tense: `ClickedIncrement`, not `Increment`. A message can carry data, as you will see with text inputs in [Events and input](/core/events/).

## Update

::source src/core/counter.silk "effect fn update"

`update` takes the model and one message and returns the next model. It is the only code that changes the model, so when a value is wrong there is one place to look.

> **Note:** `update` takes the model by value and gives it back. Silk moves it in and out, so nothing is copied and nothing else can hold a reference to the old one.

## View

::source src/core/counter.silk "fn view"

`view` describes the screen for a model. It is a plain function: the same model always gives the same screen.

| Part | What it is | Called |
| --- | --- | --- |
| `init` | The first model | Once |
| `update` | The next model, after a message | For every message |
| `view` | The screen, for a model | After every update |

## Where next

- [Views](/core/views/) covers elements, text and lists.
- A list item with `code`, **strong text** and *emphasis*.
  It continues on a second line.

1. First do this.
2. Then do that.

```sh
silk run
```

```toml title="silk.toml"
[package]
name = "counter"

[dependencies]
ui_app = { path = "../app", package = "ui-app" } # the framework
```
