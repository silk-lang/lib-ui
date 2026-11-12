# Routing

A program with more than one page keeps the page it is on in its model, like everything else. The address is just another thing that can change, and a change is just another message.

> **Note:** Routing uses nothing new: the address is a [subscription](/core/subscriptions/), the route is a field of the model, and the view is an `if` on it.

## Two pages

::source examples/src/core/pages.silk

This one has no live demo on the page, because its links would take you away from here. You are using the real thing instead: this site is a Silk UI program, and every link in its sidebar is an `h.link`. Watch the address bar as you click around. No page loads.

## Where am I

::source examples/src/core/pages.silk "fn subscriptions"

`subs.location` sends a message with the path whenever the location changes. It also sends one at the very start, before the first render, with the path the program opened at. So a program that opens at `/about` shows the about page first, with no flash of the home page.

::source examples/src/core/pages.silk "pub fn routeOf"

Turning a path into a route is an ordinary function. Make the route an enum or a union, so that `view` can `match` on it and the compiler tells you when you forgot a page.

## Links

::source examples/src/core/pages.silk "fn tab"

`h.link(path, attributes, children)` is a link to a path of your program. A click moves the location and nothing else. The subscription hears about it and `update` puts the new route in the model.

In a page, a link is a real `a` element with a real `href`: it can be opened in a new tab, copied, and followed by a crawler. The browser's back and forward buttons move the program too.

## Moving from `update`

::source examples/src/core/pages.silk "effect fn update"

Sometimes the program decides to go somewhere: after a form is saved, or when a button is not a link. `navigating(path)` on what `update` returns moves the location, exactly as a click on a link to that path would. The location subscription hears of it next.

## Testing it

A test moves the location itself and checks the model.

::source tests/src/core.silk "effect fn pagesBody"

## Recap

- The current route is state, so it is in the model.
- `subs.location` turns every change of the address into a message.
- `h.link` moves the address without loading a page, and `update` can move it too.
- A function from a path to a route is easy to test alone.

Next: [Composition](/core/composition/).
