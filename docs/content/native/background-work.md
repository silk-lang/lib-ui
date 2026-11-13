# Background work

A command runs between two messages, and the window cannot draw until it ends. So a command must be quick. Work that takes a while, such as a large file, a network request or a long computation, belongs on another thread.

The pattern has two halves, and you have seen both: a [command](/core/commands/) *starts* the work and returns at once, and the result comes back through a [port](/core/subscriptions/).

## Search

::shot native-search "The worker is at 40 percent. The window stays responsive, and Cancel works. A Silk program has no threads in a page yet, so this example is shown in pictures."

::shot native-search-done "The worker posted its answer."

The program counts the primes below five million. That takes a few seconds, and the window never stops responding.

::source examples/src/native/search.silk

## The program's side

The program knows nothing about threads. It has a service that starts work:

::source examples/src/native/search.silk "pub service Worker"

And two ports where results arrive:

::source examples/src/native/search.silk "fn subscriptions"

Between the two, `update` is ordinary. `ClickedStart` returns a command. Some time later `GotProgress` messages arrive, and finally `GotAnswer`.

## Late answers

::source examples/src/native/search.silk "effect fn update"

A worker that was told to stop may already have posted something. The program has to expect that, and it does so with plain state: progress and answers only count while `model.running` is true.

This is worth copying. A message from the outside can always arrive later than you would like.

## The app's side

::source examples/apps/search/src/main.silk

This is where the thread is.

- `window.poster()` is a handle that posts to the program's ports **from any thread**. The window's loop wakes up and `subs.port` delivers the text as a message on the UI thread.
- `Background<()>.start(work)` runs a function on a new thread.
- `Cancellation` is a flag both threads can see. The worker checks it now and then and stops when it is set.

::source examples/apps/search/src/main.silk "fn count"

The work is a plain function. It owns everything it touches: the limit, its own copy of the poster, and the cancellation flag. It shares nothing with the UI thread except through the poster.

Ports carry text, so the worker posts its numbers as text and the program shows them as they are.

```sh
silk task native demo docs/examples/apps/search
```

## Why it is built this way

There is no shared state to lock, because the only way into the program is a message. The model is only ever touched by `update`, on one thread.

And the program is still testable. A test provides a `Worker` that does nothing and posts to the ports itself:

::source tests/src/native.silk "struct Counted"

::source tests/src/native.silk "effect fn searchBody"
