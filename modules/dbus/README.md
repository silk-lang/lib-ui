# D-Bus for Silk

A D-Bus client written in Silk, used by the Linux accessibility adapter
([`accesskit-unix`](../accesskit/unix)).

- [`wire`](src/wire.silk): the marshalling format. `Writer` writes values with their alignment
  (structs, arrays, variants, dictionaries as arrays of structs); `Reader` reads them back and can
  skip any value by signature.
- [`message`](src/message.silk): messages with their header fields, method calls, returns, errors
  and signals, and `decode` for a buffer that may hold a partial message.
- [`connection`](src/connection.silk): `Bus.connect` reaches a `unix:path=` or `unix:abstract=`
  address, authenticates with `EXTERNAL` as the effective user, and says `Hello`. `send`, `flush`
  and `pump` never block, so a host can drive the bus from its event loop; `call` blocks until the
  reply and keeps other messages for `take`.

The [example](examples/src/main.silk) lists the names on the session bus.
