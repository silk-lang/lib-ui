# Nodes and styles

This page builds a card out of nodes, one call at a time: boxes, text, a word in bold, and a button that changes color under the pointer.

## A card

::shot tree-card "The card from the code below. Where the browser has WebGPU it is running: move the pointer over the button."

::source examples/src/tree/card.silk

## The kinds of node

| Call | Returns | What it is |
| --- | --- | --- |
| `tree.box(style)` | `BoxNode` | A box. It can have children |
| `tree.span(style)` | `BoxNode` | An inline box, for part of a sentence |
| `tree.text(value)` | `TextNode` | A piece of text |
| `tree.input(style)` | `InputNode` | An editable text field |
| `tree.image(source, style)` | `ImageNode` | A picture |
| `tree.icon(source, style)` | `IconNode` | A picture drawn in the text color |
| `tree.canvas(style)` | `CanvasNode` | A surface you draw on with commands |

A handle is a small value you can copy and keep. `node.id()` is its `NodeId`, which is what events and queries name nodes by.

## Putting nodes together

| Call | Does |
| --- | --- |
| `tree.append(parent, child)` | Puts `child` at the end of `parent` |
| `tree.insertBefore(parent, child, before)` | Puts it before another child |
| `tree.remove(node)` | Takes it out. It can be appended again |
| `tree.destroy(node)` | Frees it and everything in it |
| `tree.setRoot(node)` | Makes it the root |

A node that is already in the tree moves when it is appended somewhere else, as in the DOM.

After `destroy`, old handles are stale. Using one is an error that says so in a sentence, and its number is never given to another node:

```text
node #12 does not exist (it was destroyed, or never created)
```

## Text

::source examples/src/tree/card.silk "pub effect fn write"

Text is a node inside a box. It takes its look from the box: font, size, weight, color.

A sentence with a different word in it is text, a span, and more text, all in one box:

```silk
let about = run tree.box(&[css.color(rgb(0x6B7280))])
run write(&mut tree, about, "High water at ")
let strong = run tree.span(&[css.fontWeight(700.0), css.color(rgb(0x1F2937))])
run write(&mut tree, strong, "06:42")
run tree.append(about, strong)
run write(&mut tree, about, ", low at 12:57.")
```

The three flow as one line and wrap as one paragraph.

## Styles

A style is a list of CSS declarations, built with the functions of `ui_tree.css`. The names are the CSS names.

```silk
css.display(Keyword.Flex),
css.flexDirection(FlexDirection.Column),
css.rowGap(px(8.0)),
css.width(px(280.0)),
css.padding(px(20.0)),
```

Layout follows CSS: block and inline flow, flexbox, grid, absolute and fixed positioning, overflow and scrolling. The text properties inherit from parent to child, and the others do not.

`tree.setStyle(node, style)` sets more properties later. Each one replaces its earlier value, and the others stay.

## Looks for hover, press and focus

::shot tree-card-hover "The same tree with the pointer over the button. No code runs for the color change: try it."

```silk
run tree.setStyleFor(button, StyleState.Hover, &[css.backgroundColor(rgb(0x0D5F58))])
```

A node has a base look and one more for each state: `Hover`, `Active`, `Focus` and `FocusVisible`. The tree knows where the pointer is and what has focus, and switches looks by itself. A client does not listen for pointer moves to make a button light up.

## Fonts and pictures

```silk
let sans = run tree.fontFamily("Inter, Noto Sans, sans-serif")
let logo = run tree.defineImage(bytes)
```

`fontFamily` takes a list of names, as CSS does, and returns a `FontFamily` to use in `css.fontFamily(sans.raw())`. The first name the font collection has wins.

`defineImage` takes the bytes of a PNG or JPEG and `defineIcon` those of an SVG. Both return a `Resource` for `tree.image` and `tree.icon`. `tree.release(resource)` frees one.

## Names for people and tools

```silk
run tree.setRole(button, Role.Button)
run tree.setTestId(button, "refresh")
run tree.setLabel(close, "Close")
```

The role and the label are what a screen reader says. The test id is how tests and the inspector find a node: see [Inspecting a tree](/tree/inspecting/).
