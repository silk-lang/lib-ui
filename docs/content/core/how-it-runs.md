# How a program runs

A Silk UI program is a loop. This page follows one click around it, then shows the two other ways a message can arrive.

## One click, all the way around

Take the counter from [Your first program](/core/). The user clicks `+`.

```text
        the user clicks +
               │
               ▼
   Message.ClickedIncrement
               │
               ▼
   update(model, message)  ──▶  the next model
                                      │
                                      ▼
                               view(model)  ──▶  a description of the screen
                                                        │
                                                        ▼
                                          compared with the last one,
                                          and only the difference is applied
```

1. The click lands on a node that has `h.onClick(Message.ClickedIncrement)`. The runtime takes that message.
2. The runtime calls `update` with the model and the message. `update` returns the next model.
3. The runtime calls `view` with the next model. `view` returns a description of the whole screen.
4. The runtime compares that description with the previous one and applies the difference. Here, one text changes from `0` to `1`.

Then nothing happens until the next message. The program never polls and never re-renders on its own.

## Everything is a message

A click is one source of messages. There are three in all.

| Source | Example | Covered in |
| --- | --- | --- |
| The view | A click, a key, typed text | [Events and input](/core/events/) |
| A command | A request came back, a file was read | [Commands](/core/commands/) |
| A subscription | A timer ticked, the address changed | [Subscriptions](/core/subscriptions/) |

All three end in the same place: one message, handed to `update`. So `update` is the complete list of everything that can happen to your program. Reading it from top to bottom is reading the program's behavior.

## What a program is made of

A program is a model type with five functions. The first three are required.

```silk
impl Program<Message, Command> for Model {
  effect fn init() -> Update<Model, Command, NoOutput>
  effect fn update(model: Model, message: Message) -> Update<Model, Command, NoOutput>
  fn view(model: &Model, h: &Document<Message>) -> Node

  // Optional.
  fn subscriptions(model: &Model, subs: &mut Subscriptions<Message>) -> ()
  fn windows(model: &Model, w: &mut Windows<Message>) -> ()
}
```

| Function | Answers the question |
| --- | --- |
| `init` | What does the program start with? |
| `update` | What changes when this happens? |
| `view` | What does the screen show now? |
| `subscriptions` | What is the program listening to now? |
| `windows` | Which other windows are open now? |

Notice the word "now" in the last three. They are all functions of the model. You never start a timer or open a window by calling something. You return a model in which the timer is wanted, and the runtime makes the world match.

Every example in these docs starts with the same alias, so the signatures stay short:

```silk
type Next = Update<Counter, NoCommand, NoOutput>
```

`NoCommand` is the command type of a program that has no commands yet.

## Why `view` and `update` are plain

Neither `view` nor `update` can read a file, start a request, or look at the clock. The compiler enforces it: their signatures allow memory and nothing else.

- `view` is a function from the model to a description. It cannot change the model.
- `update` is a function from the model and a message to the next model. It cannot touch the outside world. When it needs something from outside, it returns a [command](/core/commands/) that says so.

That is why a program can be [tested](/core/testing/) without a window, and why the same program runs in a native window and in a browser.

## Where it runs

The runtime that drives the loop talks to a **backend**: the thing that actually puts nodes on a screen. There are three, and your program is the same for all of them.

| Backend | Draws with | Used for |
| --- | --- | --- |
| The UI tree | Its own layout, text and GPU renderer | [Native apps](/native/) |
| The document | Real DOM nodes in a page | [The browser](/core/browser/) |
| Markup | Text | Server rendering and static sites, like this one |

This site is a Silk UI program. The page you are reading was drawn to markup when the site was built, and the same program took it over when it loaded.
