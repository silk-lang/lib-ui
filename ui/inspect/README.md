# ui-inspect

The inspector core for [ui-tree](../tree): what a person, a test or an agent needs to see what a
running UI is and to drive it. The tree is plain data (mutations in, records out), so everything
here reads the tree's public state and never changes how it paints. The socket protocol
([server](server), I2) with its CLI ([cli](cli)), the MCP server for agents ([mcp](mcp), I3)
and the devtools window ([devtools](devtools), I4) build on this package.

```silk
let archive = run queryFirst(&tree, &run Query.byRoleNamed(Role.Button, "archive"))
let mut inputs = List<Input>.make()
if run click(&tree, archive, &mut inputs) {
  run session.dispatchAll(&mut tree, move inputs)    // or dispatchAll(&mut tree, ...)
}
let mut overlay = Scene.make()
run compose(&tree, &run Highlight.of(archive), &mut overlay)   // draw this instead of tree.scene()
let mut text = String.make()
run inspectNode(&tree, archive, InspectOptions.all(), &mut text)
```

## Finding nodes (`query.silk`)

- `Query` fields all have to match: `id`, `roleIs`, `name` (the accessible name: the label
  attribute, or the node's text content), `label`, `text` (the value of a text or input node),
  `testId`. Text matches are trimmed, ASCII case-insensitive substrings, as Playwright's locators
  match; `exact` asks for the whole value with its case. `within` limits the search to a subtree,
  and nodes without a box or with `visibility: hidden` are skipped unless `includeHidden`.
  Constructors: `any`, `byId`, `byRole`, `byRoleNamed`, `byName`, `byLabel`, `byText`,
  `byTestId`.
- `queryAll` (tree order), `queryFirst`, `matches`, `textContent`, `accessibleName`, `visible`.
- `hitPath(tree, x, y)`: the ids from the root to the node pointer input at that point would
  target, exactly as `UiTree.hitTest` decides (text resolves to its element, `pointer-events:
  none` is skipped).
- `pick(tree, x, y)`: what devtools' element picker selects: the topmost, deepest painted node,
  text nodes and `pointer-events: none` included, clipping respected.

## Highlight overlay (`overlay.silk`)

- `boxModels(tree, id)`: margin, border, padding and content boxes of each of the node's own
  fragments (one per line for inline boxes and text).
- `compose(tree, highlight, &mut scene)` copies the tree's last frame with `Scene.replay` and adds
  the box models of `highlight.nodes` in one isolated layer on top, in Chrome's colors (content
  blue, padding green, border yellow, margin orange). Hosts draw that scene instead of
  `tree.scene()` while the overlay is on; the atlas and uploads are the tree's, and the tree's
  own scene and paint caches are untouched. `paintHighlight` adds just the layer to a scene of
  your own. `CpuSnapshot.renderScene` draws such a scene on the CPU.

## Node view (`view.silk`)

`inspectNode(tree, id, options, &mut out)` writes the devtools side panel as text: kind, id,
role, label, test id, text, parent and children; attributes; listeners; hover, active, focus,
focus-visible and scroll state; the box model; the style patches the client set for each state
(base, hover, active, focus, focus-visible); and the computed style (only the inherited text
properties for text nodes). Properties print as CSS declarations (`writeProperty`).

## Synthetic input (`synth.silk`)

`pointOf` finds a point where hit testing reaches a node or its descendants (the centre of its
visible box, else a 5 by 5 grid over it), and returns None for nodes that are hidden, scrolled
out, covered or not targetable. `click`, `hover` and `wheel` append the input records for a node,
`press` and `tab` key records. They are the same `Input` records a window and the tree's scripted
tests feed to `UiTree.dispatch`; `dispatchAll` sends a list.

## Sessions (`session.silk`)

A `Session` drives a tree and records each step as plain data: `apply` (a mutation batch),
`dispatch` / `dispatchAll` (input records), `frame` (the frame input) and `takeEvents` (the
records the client took, kept for comparison). `replay` (or `replayInto` for a prefix) runs the
steps against a fresh tree over the same fonts and returns a `ReplayReport` with the steps run
and how many `Events` steps came out different. `copyMutation`, `copyBatch`, `copyInput` and
`copyEvent` make the copies.

## Tests

```sh
silk test --manifest-path ui/inspect/tests/silk.toml --root src/tests.silk
silk build --manifest-path ui/inspect/tests/silk.toml
build/llvm/x86_64-unknown-linux-gnu/debug/ui-inspect-tests ui/inspect/tests/goldens [--update]
```

- Queries over the inbox fixture: buttons by role and name, rows named by their text, text
  queries scoped with `within`, hit paths, and the picker finding text and respecting the nested
  scroll box's clip.
- The highlight tints the content box and margin of the nested scroll box at scale 2, leaves
  the rest of the frame alone, and leaves the tree's next frame fully replayed.
- The node view of the hovered Archive button matches exactly.
- Synthetic clicks skip a row scrolled out of view and reach it after `ScrollIntoView`.
- A session (build, click New, wheel the list, Tab twice, rename and restyle a row, with frames
  and record takes in between) replays into a fresh tree with the same `describe` output, the
  same records and the same pixels; a prefix replays part of it; a session missing a frame
  is reported as diverging.
- Goldens: `highlight.png` (the inbox at scale 2 with the Archive button and the nested scroll
  box highlighted, tolerance 2 per channel) and `inspect.txt` (the full view of the button, the
  scroll box and a text node).

## Limits

- This library has no side effects and no switch; the debug build and `SILK_UI_INSPECT` gate
  lives in [ui-inspect-server](server).
- The overlay has no name tag over the highlighted node (devtools' tooltip); that needs text
  drawn outside the tree. The devtools window names the node in its own panel instead.
- Sessions live in memory; saving them to a file is a serialization of the same unions and
  comes with the protocol.
- Replay needs the same fonts and frame sizes; nothing checks that the tree it replays into is
  fresh.
