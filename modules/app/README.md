# ui-app

A Silk UI framework in the Elm style, on top of [ui-tree](../tree): a model, messages, a pure
`view`, an `update`, and commands and subscriptions as plain data. The view is a function the
runtime calls again; it diffs the new description against the last one and sends the retained
tree the fewest `Mutation`s it can. It uses only the tree's public `Mutation` and `Event` API, so
anything this package does, another client of the tree can do too.

Components (buttons, fields, lists, tabs, menus, dialogs and more) are in
[ui-components](../components), built on this package, and [examples/notes](https://github.com/silk-lang/nonstd/tree/7d6c3693a9ad1fec24127985626ab4224f9f1995/examples/notes) is a complete
example app. [modules/README.md](../README.md) is the overview of the whole UI stack.

Packages:

- `modules/app` (`ui-app`): the builder (`ui.silk`), the diff (`diff.silk`), the app contract
  (`app.silk`), the runtime (`runtime.silk`), headless driving for tests (`harness.silk`) and
  loop helpers (`seq.silk`), and commands on fibers (`tasks.silk`).
- `modules/app/window` (`ui-app-window`): `runWindow`, the loop that runs an app in a native window
  through [modules/platform/window](https://github.com/silk-lang/lib-native/tree/main/modules/platform/window) and [ui_renderer](https://github.com/silk-lang/lib-graphics/tree/main/modules/ui_renderer).
  `runWindowWith` also serves an [inspector](../inspect/server) (debug builds with
  `SILK_UI_INSPECT` set), so ui-inspect-cli, ui-inspect-mcp and the
  [devtools window](../inspect/devtools) can look at the app.
- `modules/app/examples`: a counter and a todo list. `modules/app/demo` runs the todo list in a window.
- `modules/app/notes` (`ui-app-notes`): the Notes example in a window: menus, dialogs, the clipboard,
  a worker thread.
- [`examples/scroll-demo`](https://github.com/silk-lang/nonstd/tree/7d6c3693a9ad1fec24127985626ab4224f9f1995/examples/scroll-demo): a fully mounted mixed-document scroll stress app,
  with native controls and repeatable CPU benchmarks of the shared libraries.
- `modules/app/tests`: unit tests and the golden scenes.

## An app

```silk
pub struct Counter { pub count: i64 }
pub union Message { Increment, Decrement }

impl App<Message, NoCommand> for Counter {
  fn view(self: &Self, ui: &mut Ui<Message>) -> () {
    ui.row(
      |ui| {
        ui.gap(8.0)
        ui.button("-", || Message.Decrement)
        ui.box(|ui| { ui.testId("count"); ui.number(self.count) })
        ui.button("+", || Message.Increment)
      },
    )
  }

  fn update(self: &mut Self, message: Message, cx: &mut Context<NoCommand>) -> () {
    match move message {
      Message.Increment => { self.count = self.count + 1 }
      Message.Decrement => { self.count = self.count - 1 }
    }
  }
}

let mut runtime = Runtime<Counter, Message, NoCommand>.make(Counter { count: 0 })
run runtime.start(&mut tree, 0.0)            // creates the root and the first render
run pump(&mut runtime, &mut tree)            // after each tree.dispatch: events to messages
run tick(&mut runtime, &mut tree, now, true) // timers and frames due at `now`
```

`App<M, C>` has `view`, `update` and `subscriptions` (empty by default). The command type
implements `Perform<M, E, ? R>`: `perform` is the only effectful code in an app, and its
failures `E` and requirements `R` (a store, the network, a clock) are provided once where the app
runs, so a test swaps them. `examples/src/todo.silk` saves through a `Store` service this way,
and the tests give it a memory store. `perform` takes the command by value, so a command can
move what it carries into the work.

## Commands on fibers

By default a command runs synchronously, right after the update that made it, and its message
is handled next. A loop that runs inside a scheduler (`LocalScheduler.execute`) can run them on
fibers instead, so a slow command does not hold up input and frames:

```silk
runtime.deferCommands()                // drain keeps commands instead of performing them
let mut tasks = Tasks<Message, E>.make()
while running {
  run pump(&mut runtime, &mut tree)
  run tasks.launch(&mut runtime)       // each waiting command starts on its own fiber
  run Fiber.yieldNow()
  if (run tasks.collect(&mut runtime)) != 0 { // finished commands' messages, in finish order
    run drain(&mut runtime, &mut tree)
  }
}
```

A fiber can only use the Scheduler and the clock, so these commands implement
`Perform<M, E ? &mut Scheduler | &mut MonotonicClock>` and own what they need (a `Shared<Store>`,
not a borrowed one). `tasks.collect` raises a command's error, or `Cancelled`.

## Views

The builder opens nodes with a body: `box`, `row`, `column`, `node(kind, body)`, `input`,
`canvas`, `pressable`, and leaves with `text`, `number`, `image`, `icon` and `button`. Inside a
body, calls apply to the open node: `style` (and `hover`, `active`, `focused`, `focusVisible`
for the state variants), shorthands such as `padding`, `gap`, `background`, `color`, `fontSize`,
`width`, `height` and `grow`, the attributes `accessRole`, `label`, `testId`, `tabIndex`,
`cursor`, `disabled`, `focusTrap`, and handlers.

**Handlers are never stored.** `onClick(|| Message.Increment)` records only that the node
listens for clicks. When the tree reports an event, the runtime runs `view` again in dispatch
mode: it enters only the nodes on the event's path and calls the handlers there, in bubbling
order from the target up. `onInput(|text| ...)` hands the handler the input's new value as an owned `String`, and
`onEnter(handler)` sends a message for Enter (an input's submit). `on(kind, handler)` takes a
`fn(&Event) -> Reply<M>`, where `Reply`
is `Emit`, `EmitAndStop`, `Stop`, `Pass`, `Prevent` or `Custom`. Enter, leave, focus, blur and scroll go to the
target only. So a handler sees the model as it is when the event arrives, and nothing captured
can go stale.

Handlers run before the tree's default action, as in a browser, so they can prevent it.
`Reply.Prevent` keeps a press from moving focus, a wheel from scrolling, or a key from doing
what it does (Tab, Enter and Space clicks, editing, typed text). `Reply.Custom { message,
stopPropagation, preventDefault }` spells out all three, as Elm's `custom`. When the view knows
ahead of time, it declares it on the node instead: `ui.prevent(&[DefaultAction.Scroll])` for a
canvas that pans itself, `ui.prevent(&[DefaultAction.Focus])` for a toolbar button that must
not take focus from an editor. A host feeds input with `runtime.feed(&mut app, &mut tree,
input)`, which is `tree.begin`, the handlers, then `tree.finish` with their verdict.

The state attributes `checked`, `selected` and `expanded`, and for inputs `placeholder`,
`multiline` and `readOnly`, describe a node to the tree (and so to inspectors and tests).
`decimal(value, places)` is a text node with a number.

**Focus, anchors and overlays.** These are what popups and composite components need, still
without stored closures:

- `ui.takeFocus()` focuses the open node when this render asks and the last one did not (or the
  node is new): a dialog's first field when it opens, a menu's button when the menu closes. A
  view can keep asking while the condition holds; the last node asking wins. `ui.reveal()`
  scrolls the node into view the same way.
- `ui.anchor(key)` names the open node; before each render and dispatch the runtime reads the
  layout boxes of the anchored nodes from the tree, and `ui.anchorRect(key)` returns one (and
  `ui.anchorPressed(key)` whether a press on it is in progress). A popup places itself next to
  its button with it, and a slider maps the pointer to a value.
- `ui.overlay(key, body)` puts the nodes `body` opens in the overlay layer: a box under the root
  after everything else, so they are drawn and hit above the rest, wherever the `overlay` call
  is in the view. Their events bubble to the root. For an event in an overlay the dispatch pass
  runs the whole view to find the call, and handlers outside it do not run.

**Lists** use `ui.each(items, key, body)` (and `ui.enumerate` with the index): the first node
the body opens for an item takes its key, so the diff keeps the node (and its focus, scroll and
hover state) when the item moves. Without keys, children match by their order among unkeyed
siblings and their kind. `ui.key(value)` keys the next node by hand.

`seq` has the same loops for plain data: `forEach`, `enumerate`, `count`, and `map` and
`filter`, which build a `List` and so need an allocator. These are functions over slices, not a
`Stream` type: when std settles on one, `each` can take it without the views changing.

**`lazy(hash, body)`** reuses the last render's region when `hash` (of everything `body` reads)
is unchanged, as Elm's `Html.lazy`; the diff skips it.

## The diff

Nodes are matched while the view builds: same parent, then the same key (or unkeyed ordinal) and
the same kind. A match keeps its tree id; anything else is created, and old nodes left over are
destroyed. Within a parent, the nodes that keep their relative order are found with a longest
increasing subsequence, and only the others are moved, so rotating a list of five is one
`InsertBefore` and reversing it is four. Styles go out as the properties that changed
(`ClearStyle` first when one was removed), and text, attributes, listeners, sources and canvas
commands only when they differ. Tree ids grow and are never reused. Id 1 is the runtime's root,
a column filling the viewport.

`runtime.stats` counts renders, dispatches, messages, commands, mutations, nodes and reused
nodes, for tests and for the inspection phases.

## Subscriptions

`subscriptions(subs)` returns what the model wants now, each with a key: `every(key, seconds,
handler)`, `animationFrame`, `keyBinding(key, name, modifiers, handler)` (wherever focus is,
unless a view handler stops the key first) and `resize`. The runtime asks after every update,
starts the new keys and stops the missing ones. Handlers are delivered the way view handlers
are: by asking again and calling the one that matches. `runtime.nextDeadline()` tells a loop how
long it can wait.

## Native apps

`ui_app_window.program` runs a `Program` in a native window with nothing else to write:

```silk
effect fn app(platform: Option<Launched>) -> i32 ? &mut Allocator {
  let mut window = run Window.make("Notes", 760.0, 520.0)
  run window.font(SANS, "system-ui, sans-serif")
  let fonts = run systemFonts()
  let mut shell = window.shell()
  return run show<Notes, Message, Command, &mut Shell | &mut Allocator>(move window, &fonts, move platform)
    |> Effect.provideMut<Shell>(&mut shell)
}

fn main() -> i32 {
  return launch(app)
}
```

- `Window`: the title and size, `font`, `image`, `icon`, `lowLatency`, `uninspected`. `open` is
  `show` with the failures typed instead of printed.
- `Shell` (a service, so commands call `run Shell.copy(text)`): `setTitle`, `setSize`,
  `minimize`, `toggleFullScreen`, `quit`, `copy`, `paste`, `dark`, `setMenu(Menu)`, `openFile`
  and `saveFile`. `window.shell()` is the real one; `ShellLog` writes down what was asked, for
  tests.
- Subscriptions for what the window says: `menuAction`, `files` (a closed dialog),
  `appearance`, `windowFocus` and `closeRequested`. A program that subscribes to
  `closeRequested` keeps the window until a command calls `Shell.quit`.
- `window.poster()` is a `Poster` any thread may post to; the text arrives through
  `subs.port(key, name, handler)` on the UI thread.
- Views: `onPointerUp/Move/Enter/Leave/Cancel`, `onDoubleClick`, `onKeyUp`, `onWheel`,
  `onScroll`, `capturePointer()` (the node keeps the pointer while a button is held) and
  `scrollTo(x, y)`.

[examples/src/notes.silk](examples/src/notes.silk) uses all of it and `modules/app/notes` runs
it; [tests/src/native.silk](tests/src/native.silk) tests it with no window. The host posts to
the `PORT_*` names in `ui_app.shell`, which is also how a test speaks for the window.

## Testing and driving

`harness` drives an app without a window through the tree's real input path: `click(runtime,
tree, viewport, "Add")` finds a node by test id, label or text and clicks its center;
`press(..., "n", MOD_CONTROL)` presses a key; `locateRole` and `clickRole` find a node by role and
name ("the Save button"), `typeText` types into the focused input, and `clickAt`, `drag`,
`hover`, `moveTo` and `wheel` drive the pointer; `snapshot` returns the `describe` text. The tests
check counts and stats with these, and `modules/app/tests` renders golden scenes (`describe` text and
PNG) for the counter and the todo list. `silk task native demo modules/app/demo -- check` runs the todo list in a
real window on X11 and Wayland, clicks Add and compares a frame.

## What the inspector sees

A program keeps a `Journal`: every message with what sent it (`click #12`, `port shell:menu`,
`command Save`, `timer`), the commands `update` returned and the model afterwards. Nothing is
written by hand: `show.show` and `show.showTree` print any value by reflection (`pub` fields of
structs and unions, list items, numbers, strings), and a type reflection cannot open says how
with `impl Shown`. The window host hands the journal to the inspector, where it is the
`program`, `messages` and `model` commands and the devtools' Program tab
([ui-inspect-devtools](../inspect/devtools)). The journal keeps the last 200 steps and is only
filled while an inspector is attached.

## What depends on the tree

Views, the diff and the element model (`ui`, `diff`, `equal`, `virtual_list`) import only
`ui-protocol`: they produce mutations and read event records, and never touch a tree. Only
`runtime` and `harness` hold a `ui-tree`, so another host that speaks the protocol needs its
own runtime and nothing else.

## Backends

The runtime drives a `Backend` (`backend.silk`): `mutate` takes a render's batch, `events` gives
element records back, and `measure`, `range` and `navigate` answer the view and the shell. A
backend says what roots it shows with `roots()` (a `RootSupport`: how many, and what a root past
the first becomes), gives each root's viewport with `viewport(root)`, and hands out root events
with `rootEvents`. `UiTree` shows any number of roots, one under the native window host; `Dom`
and `Html` show the first only and answer an `OpenRoot` for another with a `Failed` root event.
A program renders into the first root: `Runtime.start` opens it with the runtime's root box,
records whose path starts elsewhere are dropped, and root events are taken and dropped.

## Limits

- `runWindow` performs commands synchronously. For native workers, use deferred commands and
  `ui-app-window.commands.Commands`, or compose `Background` jobs in `WindowContent`. See the
  [native primitives guide](window/README.md). There is no automatic cancellation by command key.
- There is no `ui.map` for embedding a child app with its own message type, and no custom
  subscription kind.
- Style and attribute calls a `lazy` body makes on its parent are not kept when the region is
  reused; open a node inside `lazy` instead.
- A `lazy` region that opened an overlay is not reused.
- Anchor boxes come from the tree's last frame, so a popup opened in the same pass that moved
  its button sits where the button was.
- Two items with the same key under one parent: the second gets a new node each render.
- Running out of memory traps.
- `view` and `update` are plain functions that allocate through `ui.alloc` and `cx.alloc`, so
  running out of memory traps instead of failing with a typed error. Effect builders would need
  `run` on every call (`run ui.row(effect |ui| {...})`, with bodies typed
  `for<'call> fn(&'call mut Ui<M>) -> mut Effect<'call; ...>`), so plain functions were kept.

The [native primitives guide](window/README.md) covers the full layout bridge, styled and
managed images, measured bounds, custom GPU content, shared text caches and OS accessibility.

## Virtual lists

`Ui.virtualItems` builds keyed content for the range requested by the backend.
Variable-height measurements, overscan selection, scroll anchoring, focus retention,
and private layout spacers live in `ui-tree`, available through its plain-data
[mutation/query protocol](../tree/README.md#virtual-scrolling). The app runtime only
forwards configuration and node bindings and reconciles new range requests.

The [scroll demo](https://github.com/silk-lang/nonstd/tree/7d6c3693a9ad1fec24127985626ab4224f9f1995/examples/scroll-demo) is a complete example. This separation removes
virtualization geometry from the app layer; the rest of `ui-app` still targets
`UiTree`. A DOM backend would require a separate adapter.

`Ui.anchored(key, options)` attaches the open popup to a node named with `Ui.anchor`.
The runtime resolves view keys to tree IDs and emits `SetAnchor`; placement then
follows tree layout and scrolling without rendering the view again. Popup hierarchy
and event handlers remain part of the view. The anchor key must exist in that view.
