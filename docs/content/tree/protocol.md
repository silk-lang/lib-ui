# The mutation protocol

Every call on a tree has a form as plain data: a **mutation**. A client that cannot call the tree directly sends mutations instead and gets the same event records back.

That covers a host written in JavaScript, a client in another process, a recording to replay, and the window host's clients on the [previous page](/tree/window/).

## A tree as data

::shot tree-remote "The tree the batches below describe, after its button was clicked."

::source examples/src/tree/remote.silk

## The client chooses the numbers

With direct calls, the tree hands out handles. With the protocol, the client names its nodes itself:

```silk
pub const ROOT: u32 = 1
pub const BUTTON: u32 = 2
pub const LABEL: u32 = 3
```

That is what lets a remote client work without waiting for answers. It never has to ask "which id did my node get", so it can send a whole screen in one batch. Font families and image resources are numbered by the client in the same way.

## A batch

::source examples/src/tree/remote.silk "pub effect fn first"

`Batch` is a builder for a list of mutations. Each method adds one, or a few that usually go together:

| Method | Adds |
| --- | --- |
| `create(id, kind)` | A new node |
| `style(id, declarations)`, `styleFor(id, state, declarations)` | Style for the base look, or for a state |
| `append(parent, child)`, `insertBefore(parent, child, before)` | Structure |
| `box(parent, id, declarations)` | Create, style and append, in one |
| `text(parent, id, value)` | Create a text, set it and append it |
| `setText(id, value)` | New text for a text or an input |
| `attribute(id, attribute)`, `testId`, `label` | Attributes |
| `listen(id, flags)` | Which events a node wants |
| `root(id)`, `openRoot`, `closeRoot` | Roots |
| `fontFamily(family, names)`, `image(resource, bytes)`, `icon(resource, bytes)` | Resources |

`batch.take()` hands over the list and leaves the builder empty for the next one.

## Applying it

```silk
run tree.apply(run remote.first())
```

`apply` runs the mutations in order. If one fails, it stops there and says which:

```text
mutation 5: node #99 does not exist (it was destroyed, or never created)
```

The mutations before it stay applied.

## Records come back with the client's numbers

::source tests/src/tree.silk "effect fn treeBody"

The last part of that test is the protocol's round trip. A click is dispatched, the record's target is `2`, the client's own number for its button, and the client answers with a batch of one mutation.

## Both at once

Direct calls and protocol numbers can share one tree. `NodeId.of(7)` names the client's node 7 for a direct call, and a node made with `tree.box` takes a number that is not in use.

```silk
let extra = run tree.box(&[])
run tree.append(BoxNode.of(NodeId.of(7)), extra)
```

## Why it matters

Because the boundary is data, the tree does not care who is on the other side.

- **Silk UI** computes the difference between two views and sends it as one batch per update.
- **The window host** hands its clients the same batches and records.
- **The inspector** reads the tree and replays input through the same door, which is why devtools work on any client.
- **A host in another language** needs only a way to send mutations and receive records. It does not have to bind every function.
