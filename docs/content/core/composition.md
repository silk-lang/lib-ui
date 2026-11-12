# Composition

Most of the time, splitting a program means splitting its view into functions, as in [Views](/core/views/). Sometimes a part of the screen is a small program of its own, with its own model and messages, and you want to use it more than once. That is a **submodel**.

## An order

::demo order

The two rows are the same stepper, used twice. The total and the Clear button belong to the parent.

::source examples/src/core/order.silk

## The child

::source examples/src/core/order.silk "impl Submodel"

A submodel looks like a program: a model, messages, `update` and `view`. It knows nothing about who uses it.

`start` returns the commands a new child begins with. This one has none.

## Putting the child in the parent

There are three places where the parent mentions its child. The model holds it:

::source examples/src/core/order.silk "pub struct Order"

The parent's messages have a variant that carries the child's messages:

::source examples/src/core/order.silk "pub union Message"

And the parent's view embeds the child's view:

```silk
h.submodel(
  &model.coffee,
  |message: StepperMessage| Message.GotCoffeeMessage { message: move message },
)
```

The second argument wraps each of the child's messages as one of the parent's. That is how a click inside the coffee stepper arrives at the parent's `update` as `GotCoffeeMessage`.

## Passing messages down

::source examples/src/core/order.silk "effect fn update"

When the parent gets one of those messages, it hands the inner message to the child with `fold`. `fold` runs the child's `update` on the child where it sits in the parent's model.

Everything the child does goes through the parent this way. Nothing is hidden: when you read the parent's `update`, you see every way the order can change.

## The child reports

::source examples/src/core/order.silk "pub union StepperOutput"

A child sometimes has news for its parent. It does not call the parent. It attaches a **report** to what its `update` returns:

```silk
return Step.of(move model).reporting(StepperOutput.Changed { by: 1 })
```

`fold` gives the report to the parent, in `folded.out`, and the parent does what it likes with it:

::source examples/src/core/order.silk "fn count"

## The parent asks

::source examples/src/core/order.silk "impl Receives"

The other direction is a request. The child says which requests it takes, and the parent sends one with `foldInput`. That is how Clear empties both steppers.

## Three channels

| Direction | What travels | How |
| --- | --- | --- |
| Child to itself | The child's messages | `h.submodel` wraps them, `fold` delivers them |
| Child to parent | Reports | `.reporting(...)`, read from `folded.out` |
| Parent to child | Requests | `Receives`, sent with `foldInput` |

A child with commands or subscriptions passes those through its parent as well: `lift` wraps the child's commands as the parent's, and `subs.submodel` does the same for subscriptions.

> **Note:** Reach for a submodel when a part has state of its own *and* is used in more than one place. For everything else, a view function and a few fields in the parent's model are simpler.
