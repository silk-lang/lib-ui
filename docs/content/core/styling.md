# Styling

Styles are CSS, written as Silk values. If you know CSS you know the names already: `css.padding`, `css.borderRadius`, `css.backgroundColor`.

> **Note:** Styling is part of the view: a look is a value computed from the model, like the nodes are. Hover, press and focus are tracked by the runtime, so they stay out of your model.

## A plan picker

::demo plans

Click a plan, then move the pointer over the others. Use Tab and the focus ring shows.

::source examples/src/core/plans.silk

## Declarations

A style is a list of declarations. Each one is a function named after its CSS property.

```silk
h.style(
  &[
    css.padding(px(14.0)),
    css.borderWidth(px(1.0)),
    css.borderStyle(BorderStyle.Solid),
    css.borderRadius(px(12.0)),
    css.backgroundColor(rgb(0xFFFFFF)),
  ],
)
```

Lengths are built with `px(14.0)` and `percent(100.0)`. Keywords are enums, such as `BorderStyle.Solid` and `Align.Center`, so a misspelled value does not compile.

A node may have several `h.style` attributes. They apply in order, and the last declaration of a property wins. That is how the card gets a base look first and its chosen look after.

## Styles that depend on the model

There are no class names to toggle. A style that depends on the model is an `if`.

::source examples/src/core/plans.silk "fn plan"

`chosen` comes from the model, so the chosen card's border and background are part of what `view` returns for that model.

## Styles that follow the pointer

Hover, press and focus are not in your model, and should not be. Nobody wants a message for every pointer move.

| Attribute | The look while |
| --- | --- |
| `h.hover` | The pointer is over the node |
| `h.active` | The node is being pressed |
| `h.focused` | The node has focus |
| `h.focusVisible` | The node has focus from the keyboard |

The node switches between these looks by itself. The model never hears of it, and `view` is not called.

`h.transition("border-color 150ms ease")` eases the change, with the syntax of the CSS `transition` property.

## Colors

A color is an `Rgba<f32>`: four numbers from 0 to 1. Most programs want to write hex codes, so the examples share a small helper.

::source examples/src/core/look.silk "pub fn rgb"

## Anything else CSS has

Every CSS property has a name in `Property`, and `css.raw` takes its value as text:

```silk
css.raw(Property.Translate, "0 1px")
```

In a page, `css.raw` passes the text to the browser, so `var(--accent)`, `clamp()` and `calc()` all work. This site's light and dark themes are CSS variables set that way. In a native window, the tree applies the properties it implements.

## A look of your own

A design system in Silk UI is a module of functions. This is the one the examples in these docs share: a button, a primary button, and the look of a text field.

::source examples/src/core/look.silk

`buttonLook` returns an `Attr`. `h.attrs` joins several attributes into one, so a look can be a base style plus its hover, press and focus variants, and still be one value to pass around.

The functions are generic over the message type `M`, which is why any program can use them.

## Recap

- Styles are CSS properties written as values, in `h.style`.
- A style that depends on your data is an `if`. A style that depends on the pointer or focus is a variant: `h.hover`, `h.active`, `h.focusVisible`.
- Share a look by writing a function that returns an `Attr`.
- `css.raw` passes any CSS through when there is no helper for it.

Next: [Events and input](/core/events/).
