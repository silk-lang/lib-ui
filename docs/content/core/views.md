# Views

A view is a function from the model to a description of the screen. This page builds one out of smaller functions, shows a list, and shows part of it only sometimes.

> **Note:** In the loop, the view is the step from the model to the screen. It is step 1 of the [tutorial](/core/tutorial/), and question 4 of [Thinking in Silk UI](/core/thinking/).

## A menu

::demo menu

::source examples/src/core/menu.silk

## Elements

Every element is a call on `h` that takes a list of attributes and a list of children.

::source examples/src/core/menu.silk "fn badge"

| Call | What it is |
| --- | --- |
| `h.box` | A box. Its children stack, like a `div` |
| `h.row` | A box that lays its children out in a row |
| `h.column` | A box that lays its children out in a column |
| `h.span` | A run of text inside a sentence, to style part of it |
| `h.button` | A box the keyboard can reach. Enter and Space click it |
| `h.link` | A link to a path of the program. See [Routing](/core/routing/) |
| `h.input` | A text field. See [Events and input](/core/events/) |
| `h.grid` | A box laid out as a CSS grid |
| `h.image`, `h.icon` | A picture, by URL |

`h.row` and `h.column` are flex containers, so the layout properties you know from CSS apply: `css.alignItems`, `css.justifyContent`, `css.columnGap`, `css.flexGrow`.

## Text

Text is a node too.

::source examples/src/core/menu.silk "fn price"

- `h.text("Breakfast")` shows a string.
- `h.number(12)` shows a whole number.
- `h.decimal(3.14159, 2)` shows `3.14`.

The view never builds strings to show numbers. That keeps `view` free of allocation, and it means a changing number touches one text node and nothing else.

## A list

::source examples/src/core/menu.silk "fn view"

`h.each` calls a function for every item of a slice and puts the nodes it returns where the `h.each` is. The function is an ordinary lambda, so it can see `model` and `h`.

For a list whose items come and go, give each item a key, so that focus and scroll position stay with the right row: see [Events and input](/core/events/).

## Showing something sometimes

There is no template language, so a condition is an `if`.

```silk
if dish.vegetarian {
  badge(h, "vegetarian")
} else {
  h.empty()
}
```

`h.empty()` is nothing at all. It leaves no node behind. The filter in the menu works the same way: a dish that should not show becomes `h.empty()`.

When a branch needs several nodes and you do not want a box around them, `h.fragment(&[a, b])` puts them directly in the parent.

## Splitting a view

`row`, `price` and `badge` above are the whole technique. A view function takes `h`, takes what it needs to show, and returns a `Node`. It has no state of its own, so there is nothing to wire up and nothing to forget.

When a part of the screen needs its own model and messages, that is a different tool: [Composition](/core/composition/).

## Naming nodes

Three attributes give a node a name that is not its look.

| Attribute | For whom |
| --- | --- |
| `h.label("Close")` | People using a screen reader. The accessible name |
| `h.accessRole(Role.List)` | The same people. What kind of thing the node is |
| `h.testId("dishes")` | Tests and the inspector |

The menu gives its list `h.testId("dishes")`, and a test finds it by that name. [Testing](/core/testing/) shows how.

## Recap

- A view is a function from the model to nodes. It runs after every update.
- Split a view into functions. That is the unit of reuse.
- Show a list with `h.each`, and give rows that can move a key.
- To show something only sometimes, use an `if`. To hide it, leave it out.

Next: [Styling](/core/styling/).
