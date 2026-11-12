# Your first tree

The UI tree is what draws a Silk UI app in a native window. It is a library of its own, and you can use it without the framework: for a custom toolkit, a game's menus, a renderer that turns layouts into images, or a binding for another language.

Think of it as a small DOM. You make nodes, put them inside each other, and style them with CSS. You feed input in and read events out. When you ask for a frame, it lays everything out and paints it.

This page reads one whole program. It makes a tree and saves a picture of it. There is no window and no GPU.

## The program

::shot tree-hello "hello.png, the file the program below writes."

::source examples/apps/tree-hello/src/main.silk

::source examples/apps/tree-hello/silk.toml

```sh
silk run --manifest-path docs/examples/apps/tree-hello/silk.toml
```

## 1. Fonts

The tree shapes text itself, so it needs fonts. It borrows a `FontCollection` for as long as it lives. This program adds one font, Noto Sans, from bytes the repository ships.

## 2. Nodes

```silk
let badge = run tree.box(&[css.padding(px(20.0)), ...])
let words = run tree.text("Hello, tree")
run tree.append(badge, words)
```

A node is made on its own, then put somewhere. Until it is appended, or made the root, it is not part of what is drawn.

`tree.box` returns a `BoxNode` and `tree.text` a `TextNode`. The kind is part of the type, so appending a child to a text node does not compile.

`tree.setRoot(page)` makes a node the root. The root is as wide as the viewport.

## 3. A frame

```silk
drop run tree.frame(Viewport { width: 480.0, height: 240.0, scale: 2.0 }, 0.0)
```

Nothing is laid out or painted until you ask for a frame. A frame does three things: it resolves styles, lays out, and paints into a **scene**, which is a list of things to draw.

The viewport is in CSS pixels. `scale` is how many device pixels each one is: 2 on a dense screen. The second argument is the time in seconds, which a blinking caret needs.

A frame only redoes what changed since the last one. Change one text and ask again, and one text is laid out and painted.

## 4. Pixels

A scene is not pixels yet. In a window, a GPU renderer draws it, and [In a window](/tree/window/) shows that. Here a `CpuSnapshot` draws it in memory and `encodePng` makes a PNG of the result.

The CPU drawing is the reference the GPU is tested against, so the picture is what a window shows.

## What the tree is, and is not

| The tree does | The tree leaves to you |
| --- | --- |
| Layout: block, inline, flex, grid, positioning, scrolling | Deciding what the UI is |
| Text: shaping, wrapping, selection, editing, input methods | Keeping your own state |
| Hover, press and focus looks, tab order, hit testing | Answering events |
| Painting into a scene | A window and a GPU, which the window host adds |

The tree holds no closures and calls nothing back. What crosses its boundary is plain data: styles and text go in, event records come out. That is why Silk can drive it directly, and why a JavaScript host or another process can drive it through the [mutation protocol](/tree/protocol/).

## Where the framework fits

[Silk UI](/core/) is one client of this tree. Its runtime turns your `view` into the node calls on this page and turns the tree's event records into your messages. Everything in the [Native apps](/native/) guide ends up as a tree like this one.
