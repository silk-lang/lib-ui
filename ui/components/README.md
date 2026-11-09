# ui-components

Components for [ui-app](../app) views: buttons, checkboxes and switches, a slider, text fields
and text areas, lists, select lists and virtual lists, scroll views, tabs, menus and selects,
dialogs, popovers and tooltips, plus layout and text helpers and a theme.

Packages:

- `ui/components` (`ui-components`): the components, one module per family (`theme`,
  `layout`, `button`, `choice`, `slider`, `field`, `list`, `tabs`, `menu`, `dialog`,
  `popover`), all re-exported from `lib`.
- `ui/components/gallery`: an app with every component, its state in one model.
- `ui/components/tests`: one scripted test per component, a keyboard-only test, and describe and
  PNG goldens of the gallery.
- `ui/components/demo`: the gallery in a native window (`scripts/demo`, and `scripts/demo
  check` for CI).

## Using them

A component is a function generic over the app's message type. It takes the builder, the
[`Theme`](src/theme.silk), what it shows, and how to make the app's messages:

```silk
let theme = self.theme
checkbox(&mut ui, &theme, "I agree", self.agree, |value| Message.Agree { value: value })
slider(
  &mut ui,
  &theme,
  VOLUME,
  "Volume",
  self.volume,
  SliderRange { min: 0.0, max: 100.0, step: 5.0, places: 0 },
  |value| Message.Volume { value: value },
)
textField(
  &mut ui,
  &theme,
  "Name",
  "Your name",
  String.view(&self.name),
  |text| Message.Name { text: move text },
  |ui| {
    ui.onEnter(|| Message.Submit)
  },
)
```

As everywhere in ui-app, handlers are lambdas the view calls during dispatch, never stored, and
the model owns the values. What a browser keeps in the element stays in the tree: focus, hover,
scroll offsets, the caret, the selection and input method state.

Components with more state keep it in a small struct the app stores in its model:

- [`MenuState`](src/menu.silk) for `menu` and `select`, with a `MenuMessage` union and
  `update`, which returns the chosen item (`MenuState.endAligned()` for a menu at the right edge
  of the window, whose list lines up with the button's right edge, and `.ghosted()` for a
  borderless button in a toolbar):

  ```silk
  menu(&mut ui, &theme, FILE, &self.fileMenu, "File", &COMMANDS, |m| Message.File { message: m })
  ...
  Message.File { message } => {
    if let Option<usize>.Some { value } = self.fileMenu.update(message) { ... }
  }
  ```

- [`Disclosure`](src/dialog.silk) (`open`, and whether focus goes back to the button) for
  `dialog` and `popover`, with `show`, `hide` and `set`.

This is the submodel pattern of the F1 design without `ui.map`: the component takes the
function that wraps its messages in the app's.

Keys (`u64`) name the nodes a component needs to find again: a slider's track, a menu's
button, a tooltip's target. They must be unique in the view.

## The components

| Component | Keyboard | Notes |
| --- | --- | --- |
| `button`, `primaryButton`, `buttonWith` (tones Primary, Secondary, Ghost, Danger; disabled), `buttonBox` | Enter, Space | role button |
| `checkbox`, `checkboxWith` (disabled), `switch` | Space | roles checkbox and switch, `checked` |
| `slider` | arrows (one step), Page Up and Down (ten), Home, End | role slider; click or drag the track |
| `textField`, `textArea` | the tree's editing keys; `ui.onEnter` for submit | placeholder, controlled value |
| `list` | | roles list and listitem, keyed rows |
| `selectList` | Up, Down, Home, End | one tab stop; roles listbox and option, `selected`; the selected row scrolls into view |
| `virtualList` | | only the rows in view exist; the model keeps the scroll offset |
| `scrollView`, `card`, `stack` and `layer`, `spacer`, `divider`, `heading`, `caption`, `paragraph` | | layout and text |
| `tabs` | Left, Right (wrapping), Home, End | one tab stop; roles tablist, tab (`selected`) and tabpanel |
| `menu`, `select` | Enter, Space or Down open; Up, Down, Home, End; Enter or Space choose; Escape or Tab close | roles menu and menuitem, listbox and option; `expanded` on the button |
| `dialog`, `dialogButton` | Escape closes; Tab stays inside | role dialog, focus trap; a click on the scrim closes |
| `popover` | Escape closes | non-modal; a press outside closes |
| `tooltip` | shows on focus too | role tooltip; called inside the target's body |

Popups (menus, selects, popovers, dialogs, tooltips) go in the framework's overlay layer
(`ui.overlay`), drawn above the rest of the view, and place themselves next to their button with
`ui.anchorRect`. Focus moves into them when they open and back to their button when they close
(`ui.takeFocus`).

## What the framework gained for them

ui-app grew a few general pieces (see its README): `ui.overlay(key, body)`, `ui.anchor(key)`
with `ui.anchorRect` and `ui.anchorPressed`, `ui.takeFocus()` and `ui.reveal()`, the state
attributes `checked`, `selected` and `expanded`, the input attributes `placeholder`,
`multiline` and `readOnly`, `ui.decimal`, `ui.onEnter`, and `onInput` handing the handler an
owned `String`. ui-tree grew the `Checked`, `Selected` and `Expanded` attributes and the roles
slider, switch, listbox, option and tooltip, all in `describe`; Space presses switches and
options, and Enter presses options. The harness can find nodes by role (`locateRole`,
`clickRole`), type (`typeText`), drag, hover, move the pointer and scroll the wheel.

## Limits

- No menu submenus, no type-ahead in lists and menus, no multi-select.
- Popups open below their button (lined up with its left edge, or its right edge for an
  end-aligned menu); they do not flip when there is no room, and do not follow
  the button when a scroll container moves it until the next render.
- A press outside a menu or popover closes it and is not delivered to what is under it.
- Tooltips show at once; there is no delay.
- The virtual list's rows all have one height.
- No date or color pickers, no radio group, no progress bar yet.
