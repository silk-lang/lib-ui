# ui-assets

Embedded fonts, icons and photos for UI fixtures, tests and demos: two Noto Sans subsets, the
toolbar and card icons, an animated orbit SVG, and procedural photos. They were the
[graphics demo](https://github.com/silk-lang/nonstd/tree/7d6c3693a9ad1fec24127985626ab4224f9f1995/examples/graphics-demo)'s assets, and moved here because ui-tree's fixtures,
ui-app tests and several demos use them too. Import `assets` for typed accessors (`regularFont`,
`icon(index)`, `photo(index)` and the icon constants).

Fonts are subsets of Noto Sans (SIL Open Font License, `assets/fonts/Noto-LICENSE-OFL.txt`).
Icons were drawn for the graphics demo. Photos are committed procedural landscapes; the optional
`scripts/generate-photos` authoring tool uses Pillow and is never part of a normal build or check.

`src/generated_assets.silk` embeds every file under `assets/` as a byte string. Regenerate it
with `node ui/assets/scripts/embed-assets` from the repository root after changing an asset (CI runs `--check`). It exists because
`silk.build.source.Source.read` in a dependency package, at Silk 0.1.0-dev.45 (first seen in dev.44), resolves the path
under that package's `src/` and lexes the file as Silk, so assets cannot be read at build time
by a library.
