# AccessKit for Silk

A port of [AccessKit](https://github.com/AccessKit/accesskit) to Silk. An application describes
its UI as an accessibility tree of [`Node`](src/node.silk)s and sends it to a platform adapter as
incremental [`TreeUpdate`](src/update.silk)s; the adapter answers screen reader queries from it and
hands their requests back as [`ActionRequest`](src/update.silk)s.

| Package | AccessKit crate | What it holds |
| --- | --- | --- |
| `accesskit` (this directory) | `accesskit` | The schema: nodes, roles, actions, geometry, updates |
| `accesskit-consumer` ([consumer](consumer)) | `accesskit_consumer` | The tree adapters keep: applies updates, reports changes, filters, navigation, text ranges |
| `accesskit-unix` ([unix](unix)) | `accesskit_unix`, `accesskit_atspi_common` | The Linux adapter: AT-SPI over D-Bus, with the D-Bus client in [`modules/dbus`](../dbus) |
| `accesskit-macos` ([macos](macos)) | `accesskit_macos` | The macOS adapter: NSAccessibility elements for a view |

The Windows adapter follows in this directory.

## Linux

[`App`](unix/src/adapter.silk) connects to the accessibility bus (`AT_SPI_BUS_ADDRESS`, or the
address `org.a11y.Bus` gives on the session bus), embeds itself under the desktop with the
registry, and serves the AT-SPI interfaces of each window it is given: `Accessible`,
`Application`, `Component`, `Action`, `Value`, `Text`, `EditableText`, `Selection`, `Image`,
`Hyperlink`, `Document`, the `Cache`, and `Properties`, `Introspectable` and `Peer`. Each
`updateWindow` sends the events the update causes (state, property, children, text, caret,
selection, bounds, window activation and cache signals). The host calls `pump` when the bus socket
([`descriptor`](unix/src/adapter.silk)) is readable, and performs what `takeRequests` returns.

```silk
let address = run accessibilityBusAddress(Option.None)
let mut app = run App.connect("My app", address.view(), Option.None)
run app.addWindow(1, initialUpdate, true, WindowBounds.zero())
// each frame, or when the socket is readable:
run app.pump()
let requests = run app.takeRequests()
```

The [example](unix/examples/src/main.silk) runs against a real registry. With `at-spi2-core` and
`python3-pyatspi` installed, start a bus and the registry, run the example, and drive it with
[`atspi_client.py`](unix/examples/atspi_client.py), which reads the tree through libatspi and
clicks the button and the checkbox:

```sh
dbus-daemon --session --print-address --fork   # note the address
export AT_SPI_BUS_ADDRESS=<address> DBUS_SESSION_BUS_ADDRESS=<address>
/usr/libexec/at-spi2-registryd &
silk build --manifest-path modules/accesskit/unix/examples/silk.toml
modules/accesskit/unix/examples/build/llvm/*/debug/accesskit-unix-examples &
python3 modules/accesskit/unix/examples/atspi_client.py
```

Object paths are `/org/a11y/atspi/accessible/<window>/<node>`, where `<node>` is the consumer's
64-bit node id (`FullNodeId.toU64`) instead of AccessKit's 128-bit one.

## macOS

[`Adapter`](macos/src/adapter.silk) keeps the NSAccessibility elements of one view in step with
the tree. AccessKit's elements ask the tree on every AppKit call; here the Silk side computes the
same answers ahead of time and sends each element as a byte record (layout in
[`record.silk`](macos/src/record.silk)) whenever it changes, and the AppKit side in
[`native/adapter.m`](macos/native/adapter.m) answers from it. Text fields carry their lines,
character boxes and format runs, so the text range calls (`accessibilityRangeForPosition:`,
`accessibilityFrameForRange:`, `accessibilityAttributedStringForRange:`, ...) need no round trip.
As AccessKit's `SubclassingAdapter` does, the view's class is swapped for a subclass whose
accessibility children, focused element and hit test are the adapter's.

```silk
// The platform window host's content view for window `id`:
let sink = NativeSink.forWindow(id.value).unwrap()
let mut adapter = run Adapter.make(move sink, initialUpdate, true)
run adapter.update(nextUpdate)          // raises the notifications it causes
run adapter.updateViewFocus(false)      // when the window loses key status
run adapter.pump()                      // after the event loop ran
let requests = run adapter.takeRequests()
```

`RecordingSink` stands in for AppKit in tests, so the adapter's behaviour is tested on every
platform; on macOS the tests also read the elements back through AppKit.

The consumer differs from the Rust crate where Silk has no equivalent: filters are values of a
`NodeFilter` interface instead of closures, iterators are `FilteredCursor`s or fill a `List`, and
functions that build strings take an `Allocator` effect (`label()`, `Range.text()`).

Names follow Silk style: `set_label` is `setLabel`, `Node::new` is `Node.make`, and because `role`
is a Silk keyword, `role()` and `set_role` are `accessRole()` and `setAccessRole`. Associated
constants are functions: `TreeId.root()`, `Affine.identity()`, `Rect.zero()`.

## License

AccessKit is Copyright 2023 The AccessKit Authors (see [AUTHORS](AUTHORS)) and is licensed under
either of the [Apache License 2.0](LICENSE-APACHE) or the [MIT license](LICENSE-MIT), at your option.
This port keeps that license for the files here. Role and property descriptions derived from
Chromium are under the BSD license in [LICENSE.chromium](LICENSE.chromium).
