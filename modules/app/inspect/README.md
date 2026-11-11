# ui-app-inspect

silk-ui's inspector extension, `silk-ui`: what a silk-ui program adds to the inspector
([ui-inspect-server](../../inspect/server)), which knows the tree and nothing else. It is
registered and served through the inspector's extension API
([Extensions](../../inspect/server/README.md#extensions)), the way any other framework would add
its own; ui-app itself knows no inspector, and the inspector, its CLI, its MCP bridge and the
devtools know nothing of silk-ui.

| Name | Members | What |
| --- | --- | --- |
| `silk-ui.program` | | `attached`; `steps` held with the `first` and `last` seq; the `model` now, as text; `subscriptions`; `stats`: `renders`, `dispatches`, `messages`, `commands`, `mutations`, `nodes`, `reused` |
| `silk-ui.messages` | `since` (a `seq`), `limit` | `messages`: the steps after `since`, oldest first, each `{"seq", "time", "cause", "message", "commands", "changed"}`; `next` |
| `silk-ui.model` | `seq` (default: the last step) | `model`: the model after that step, one line per field; `diff`: `{"op": " "\|"+"\|"-", "line"}` against the step before; `changed` (lines) |
| topic `silk-ui.message` | | the program handled messages; `next` is the `seq` the next one gets |
| panel `program` | | "Program": data `silk-ui.program`, read again on `silk-ui.message`, and a view on `silk-ui.view.program` |

The MCP bridge makes `silk_ui_program`, `silk_ui_messages` and `silk_ui_model` of the commands;
the CLI runs them by name (`ui-inspect-cli silk-ui.messages --since 4`).

```silk
let mut inspector = run startInspector(InspectorOptions.make())
run inspector.extend(run SilkUi.extension())
let mut silkUi = SilkUi.make()
// on every turn of the loop, while the inspector is on:
run silkUi.record(&mut runtime)                  // the journal's new steps, counters, subscriptions
run inspector.serveExtension(ID, &mut silkUi)    // answer, push the topic, render the panel
```

`ui-app-window` does exactly this for every program it runs.

## The Program panel

`panel.silk` is a silk-ui program of its own, written with `Document`: the counters and
subscriptions, then every message newest first with what sent it and the commands `update`
returned, a marker on the steps that changed the model, and a click on a step opens the model
after it with the lines it added and removed. It runs in the app, on a `ViewBackend` whose
batches go to the clients that opened the panel and whose events come back from them, only while
one has it open; opening it again starts it from nothing. A client draws it with its own fonts
and look (the devtools replay it, see
[Remote views](../../inspect/devtools/README.md#remote-views)).

## Tests

- `modules/app/window/tests` (`silk_ui.silk`): a counter program and the extension over a
  session in the same process: hello lists it, the inspector itself has no `messages`, a request
  waits until the extension is served and then gets the messages, the topic is pushed, a model
  diff, the program and an unknown step; the Program panel's view runs only while subscribed,
  starts from nothing, follows a new message, and stops when closed.
- `modules/inspect/devtools/tests`: the devtools show the Program panel the app renders, in the
  tests' session and in the app's own process, and a golden scene of it.

## Limits

- The log keeps the last 200 steps. A model is text (what `show` prints), so `model` diffs
  lines, not values, and there is no time travel: an old model can be read, not put back.
- While the panel is open it keeps its own copy of the steps the log holds.
