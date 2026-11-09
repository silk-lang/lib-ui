# ui-text

Text for the retained UI: css-layout's `TextMeasure` over real fonts. It breaks lines with
UAX #14, orders bidirectional text with UAX #9, picks fonts per character from a
[font-collection](https://github.com/silk-lang/lib-fonts/tree/main/fonts/collection), shapes with [font-shape](https://github.com/silk-lang/lib-fonts/tree/main/fonts/shape) and keeps
the shaped glyphs of every fragment for [font-raster](https://github.com/silk-lang/lib-fonts/tree/main/fonts/raster) to draw.

- `system.TextSystem` is the provider. `TextSystem.make(&collection)` borrows the fonts;
  `addStyle(TextStyle.make(families, size))` registers a text style and returns the key to put
  in `Style.fontKey`. Pass the system to `compute` as its `TextMeasure`, and forward
  `Measure.font` to `TextSystem.font` (the system's own `Measure` does that for trees with only
  text in them).
- Fallback runs get their own font keys, so a fragment's `fontKey` names the face that drew it;
  `keyInfo(key)` gives its style, face and size.
- `TextFragment.shapeKey` names a `glyphs.GlyphRun`: `glyphRun(key)` gives its font, size,
  direction and advance, and `runGlyphs(key)` its glyphs in visual order, positioned from the
  fragment's left edge and baseline in CSS pixels. `rasterFace(fontKey)` gives the
  `font-raster` face for those glyphs. Identical runs share a key, so reshaping during line
  fitting costs no memory. `glyphs.clear()` frees them all; invalidate the layout tree after.
- `fonts.FontState` computes `FontMetrics` from the face: ascent, descent and line gap from
  `hhea` or the typographic `OS/2` metrics, rounded to whole pixels as Chrome does, x height,
  cap height, the `0` and space advances, baselines and sub and superscript offsets.

Layout handles justification (extra space on word separators, or on every cluster for
`text-justify: inter-character`), soft hyphens (U+2010, or `-` when the font lacks it) and
`unicode-bidi` on inline boxes.

## Agreement with Chrome

`scripts/chrome-text.mjs` lays out the cases in `tests/chrome/cases.json` with `tools/cli/` and
with Chrome on the same font files, and compares the rectangle of every text fragment:
The unchanged subset files and their OFL notices are owned under `ui/text/tests/fonts`.
Both the unit tests and Chrome comparison run with the repository root as their working directory.

```sh
silk build --manifest-path ui/text/tools/cli/silk.toml
node ui/text/scripts/chrome-text.mjs --cli build/llvm/x86_64-unknown-linux-gnu/debug/ui-text-cli
```

The cases cover wrapping, kerning, mixed styles, line heights, alignment and justification,
white space modes, soft hyphens, combining marks, Arabic and Japanese fallback, right to left
and mixed direction text, and isolates. Line breaks must match exactly. Positions must agree
within:

- 0.1 px inline. Chrome rounds each text box to 1/64 px, which adds up along a line; the
  largest difference seen is under 0.06 px.
- 0.5 px in the block direction. Blink floors the half-leading to whole pixels, while
  css-layout keeps the exact half (CSS Inline 3).

Known differences:

- Blink does not break after `/` in URLs; UAX #14 does, and so does this package.
- Vertical writing modes shape text horizontally.
- There is no synthetic bold or oblique.
- `line-break` and `word-break` take their default values.
