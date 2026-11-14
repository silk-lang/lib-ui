# ui-js-node

Runs a ui-js application on the SilkJS runtime instead of the bare engine: the realm has
Node's APIs and the web APIs Node has (`fetch`, `WebSocket`, `URL`, `TextEncoder`,
`crypto`, `AbortController`, `structuredClone`, `Intl`, timers, `process` and the rest), with
`@silk/ui` beside them. Use it when an application needs the network or other platform APIs;
`ui-js-window` stays the smaller choice for one that does not.

The runtime runs on the window's UI thread. The window host waits in the runtime's loop
(`NodeClient` waits itself), and window events end that wait, so timers, sockets and files
cost nothing while idle. Animation frames and events are the window's, as with
`ui-js-window`. An uncaught exception is printed and the window keeps running.

```silk
let mut window = NodeWindow.make(&fonts, options, NodeClient.make())
run window.define(b"@silk/ui", uiPackage())
run window.entry(b"/app/app.js", source)
let status = run window.start(b"my-app")
```

The entry is named by an absolute path or a URL; its relative imports and `import.meta.url`
resolve from it.

## Building

The runtime's built-in JavaScript and its native libraries are made by lib-silkjs's own
tools, not by Silk. Once per lib-silkjs revision, before the first build:

```sh
python3 modules/js/node/scripts/prepare
```

It needs pkg-config to find static libuv 1.50 or newer, OpenSSL 3.2 or newer, nghttp2, zstd
and Brotli (lib-silkjs's `modules/runtime/README.md` says how to build them; nghttp2 wants
`-DENABLE_LIB_ONLY=ON -DBUILD_TESTING=OFF`). The runtime does not build for Windows yet.

The script downloads the runtime's vendored sources from codeload.github.com. Where a proxy
refuses that, put `git archive` tarballs of the pinned commits in the runtime's `build/deps`
(the checksums match). The first link of a program takes a while and needs memory: allow
about 9 GB for silkc.

## Checking

`tests` is a program that runs `fixtures/net.js` in the runtime-backed realm against a local
HTTP and WebSocket server (`fixtures/server.mjs`, run by Node). CI's `node` job runs it on Linux,
with the natives from Ubuntu's static archives:

```sh
silk build --manifest-path modules/js/node/tests/silk.toml
python3 modules/js/node/scripts/check modules/js/node/tests/build/<binary>
```
