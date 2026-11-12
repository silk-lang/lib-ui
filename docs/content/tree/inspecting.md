# Inspecting a tree

A tree can tell you what is in it, where layout put each node, and what a point on the screen hits. Tests use that, and so do the devtools. This page goes through the questions you can ask.

## Finding nodes

```silk
let found = run tree.find("refresh")
```

`find` returns the nodes whose test id, label or text is the given string. Give the nodes you care about a test id, with `tree.setTestId`, and tests can find them however the layout changes.

## Where things are

```silk
if let Option.Some { value: box } = run tree.bounds(button) {
  // box.xMin, box.yMin, box.xMax, box.yMax, in CSS pixels of the viewport
}
```

`bounds` is a node's border box after the last frame. A node that is not laid out, such as one that is detached, has none, so the answer is an `Option`.

`tree.fragments(node)` gives one box per line for inline content that wraps.

## What a point hits

```silk
let hit = tree.hitTest(200.0, 150.0)   // what pointer input there would target
let seen = tree.pick(200.0, 150.0)     // what an element picker would select
```

`hitTest` answers exactly as input does: text resolves to its box, and nodes with `pointer-events: none` are skipped. `pick` is for tools: it returns the topmost painted node, whatever it is.

## One node, in full

```silk
if let Option.Some { value: view } = tree.view(button) {
  view.accessRole()               // Role.Button
  view.testId()                   // "refresh"
  view.state()                    // hovered, pressed, focused, focusVisible
  view.listens(EventKind.Click)   // whether it listens
  view.style(StyleState.Hover)    // the declarations set for a look
  view.computed()                 // the resolved style
}
```

A `NodeView` is a read-only look at one node: its attributes, its state, the styles the client set for each look, and the computed style layout used. It is what the devtools' side panel shows.

## The whole tree as text

```silk
let text = run tree.describe(DescribeOptions.plain())
```

`describe` writes the tree as indented text, one node per line, with its kind, id, role, test id, text and box. This is the card from [Nodes and styles](/tree/nodes-and-styles/):

```text
box #1 [0,0 400x240]
  box #2 [39,45.5 322x149]
    box #3 [60,66.5 280x27]
      text #4 "Tide tables" [60,66.5 108.64x27]
    box #5 [60,101.5 280x20]
      text #6 "High water at " [60,101.5 99.29x20]
      box #7 [159.29,101.5 38.6x20]
        text #8 "06:42" [159.29,101.5 38.6x20]
      text #9 ", low at 12:57." [197.88,101.5 96.34x20]
    box #10 role=button testId="refresh" [60,137.5 280x36]
      text #11 "Refresh" [173.12,145.5 53.76x20]
```

`DescribeOptions.withStyles()` adds what each node looks like, and `tree.describeNode(node, options)` writes one subtree:

```text
box #10 role=button testId="refresh" [60,137.5 280x36] background=rgba(15,118,110,1) radius=8 color=rgba(255,255,255,1)
  text #11 "Refresh" [173.12,145.5 53.76x20]
```

That text is a good thing to keep in a test. Save it, and compare it on every run: a layout that moves by a pixel shows up as one changed line you can read, which a picture that differs cannot give you.

## Pictures

::source examples/src/tree/picture.silk

Every picture in this guide was made with this `Camera`, by the docs build, from the example code on the page. It draws on the CPU, so it needs no window and gives the same pixels on every machine.

Pictures and `describe` text together are how the tree's own tests work: each scene has a saved `.txt` and a saved `.png`, and a change to either fails the test.

## Testing a tree

::source tests/src/tree.silk

A test drives a tree the way a window does: it dispatches input and reads records. There is nothing to mock, because nothing in a tree reaches outside.

## Inspecting a running app

All of the above is also available from outside a running app, over a socket: the tree as text, a node's styles, screenshots, and real input. That is the inspector, and the devtools and the command line tool are built on it. [Devtools](/native/devtools/) covers it, and it works the same for a bare tree client as for a Silk UI app.
