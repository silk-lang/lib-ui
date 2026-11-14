# The Shape of Words

A magazine in five spreads that shows what the tree does with text: nine scripts with
font fallback, bidirectional paragraphs, vertical writing modes, sideways headers, floats
and justified columns. Each feature on a page carries a small label naming the CSS that
draws it. [src/App.jsx](src/App.jsx) is the whole page; click the spreads at the bottom or
use the arrow keys.

The same `src/` also runs in a browser, so the two can be compared side by side.

```sh
# from modules/js, once
npm ci
# from modules/js/examples/text-showcase
npm run fonts      # Noto faces from Google Fonts and Twemoji into fonts/ (not in git)
npm run build      # dist/app.js
# from the repository root
silk run --manifest-path modules/js/demo/silk.toml --profile dev -- \
  --fonts modules/js/examples/text-showcase/fonts modules/js/examples/text-showcase/dist/app.js
# the browser build, from the example
npm run dev:web
```

Both hosts draw with the same font files: the ui-js window takes the directory with
`--fonts`, and the browser build declares each file with `@font-face`
(`fonts/fonts.css`, written by `npm run fonts`). The browser build reuses the starter
page's `<box>` for React DOM ([../react-counter/web](../react-counter/web)).

Emoji are Twemoji, in COLR version 0 layers: the tree does not draw COLR version 1 paint
graphs yet, which is what Google's Noto Color Emoji is made of.
