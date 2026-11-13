# React starter page

The ui-js starter page in React: click anywhere and the count rolls, the dot field
shocks and sparks fly. [src/](src) is the app. The same files also run in a browser engine,
so the page can be compared side by side on three hosts:

| host | entry | build and run |
|---|---|---|
| ui-js (SilkJS on the tree) | [src/main.jsx](src/main.jsx) | `npm run build`, then `silk run --manifest-path modules/js/demo/silk.toml modules/js/examples/react-counter/dist/app.js` from the repository root |
| Electron | [web/main.jsx](web/main.jsx), [electron/main.cjs](electron/main.cjs) | `(cd electron && npm install)` once, then `npm run electron` |
| Tauri | [web/main.jsx](web/main.jsx), [tauri/src/main.rs](tauri/src/main.rs) | `npm run tauri` (Rust, and on Linux the WebKitGTK 4.1 development packages) |

`npm run dev:web` serves the browser build to any browser.

Every host opens the same window: 1040x720, titled "Silk UI", with the page drawing its
own 56-pixel title bar on macOS where the window controls sit.

## How the browser build runs the same files

[vite.web.config.js](vite.web.config.js) compiles `src/` unchanged, with two substitutions:

- **`<box>`** is [web/box.js](web/box.js), through the JSX runtime
  ([web/jsx-runtime.js](web/jsx-runtime.js)): a `div` that also takes the tree's props.
  `hoverStyle` is laid over `style` while the pointer is on the box, `href` opens a link
  on a click nothing prevented, `onLayout` gets `{ bounds }` from a `ResizeObserver`,
  `cursor` and `testId` become CSS and `data-testid`, and `ref` gets a node like the
  tree's.
- **`@silk/ui`** is [web/silk-ui.js](web/silk-ui.js): `createBox` and the node's
  `style.set`, `append` and `destroy` on elements, which is what
  [src/motion.js](src/motion.js) draws with.

[web/page.css](web/page.css) gives the page what the tree gives it unasked: the same font
files the ui-js window draws with (Geist, Geist Mono and the Noto Sans subsets), no
margins, and no text selection.

Each host prints `react starter: first frame` two animation frames after the first render.
`node modules/js/bench/run.mjs --app starter` measures the three with it (size, memory,
startup, CPU while animating); see [the benchmark](../../bench/README.md#the-starter-page).
