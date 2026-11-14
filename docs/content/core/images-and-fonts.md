# Images and fonts

A program shows photos, icons and text in fonts of its own. This page builds an album with all three: photos that are PNG and JPEG files, icons that are SVG files, and titles and labels in two fonts that ship with the app.

## An album

::demo album

Click a photo to open it, like it with the heart, search by title, or list only the ones you like.

::source examples/src/core/album.silk

## Files are URLs

A view never holds a file. It names a picture by URL, as an `<img>` does, and a program names the file of a font by URL, as an `@font-face` rule does. The host loads them. A relative URL is one of the app's own files.

```silk
Photo { index: 0, title: "Dusk", file: "photos/dusk.png", png: true },

pub const HEART: string<'static> = "icons/heart.svg"
```

| In the view | What it shows | The file |
| --- | --- | --- |
| `h.image("photos/dusk.png", attrs)` | A raster image | A PNG or JPEG |
| `h.icon("icons/heart.svg", attrs)` | A vector icon | An SVG |
| `css.fontFamily(DISPLAY)` | Text in a font | TTF or OTF files (WOFF2 on a page) |

The URL's scheme says how it loads:

| URL | Loaded from |
| --- | --- |
| `photos/dusk.png` | The app's own files: next to the page, or built into a native program |
| `https://example.com/a.png` | The network, off the UI thread natively |
| `file:///home/me/a.png` | A local file (native only) |
| `data:image/png;base64,...` | The URL itself |

Each URL loads once, however many nodes show it. Until it has loaded, the node shows nothing. `h.onLoad(message)` and `h.onError(message)` say when it is ready or could not be loaded, as the DOM's `load` and `error` events do.

## Raster images

`h.image` is the `<img>` of Silk UI. It takes the URL and the usual attributes. Give it a label, which is its alt text.

::source examples/src/core/album.silk "fn viewer"

The style sizes it. `css.objectFit(ObjectFit.Cover)` fills the box and crops what does not fit, as `object-fit` does in CSS. `ObjectFit.Contain` shows all of it instead. `css.borderRadius` rounds its corners.

## Vector icons

`h.icon` draws an SVG the way a page draws an inline `<svg>`: its `currentColor` is the color of the text, so an icon drawn in `currentColor` takes that color, like an icon font. The heart is one file, and the like button makes it red or gray with `css.color`.

::source examples/src/core/album.silk "fn like(h"

Draw an icon's shapes with `fill="currentColor"` or `stroke="currentColor"`. In the album, `heart.svg` is filled and `search.svg` is drawn with strokes, and both work the same way. Shapes in fixed colors, such as a logo's gradient, keep those colors.

```html
<!-- docs/examples/apps/album/assets/icons/heart.svg -->
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M12 21 C5 15.5 2 12.5 2 8.5 A5 5 0 0 1 12 6 A5 5 0 0 1 22 8.5 C22 12.5 19 15.5 12 21 Z"/></svg>
```

An icon scales without blurring, so size it with `css.width` and `css.height` and use the same file everywhere.

## Fonts

A `Font` is a CSS `font-family` list, made once as a constant. The album uses two: Geist for titles and Geist Mono for small labels and numbers.

```silk
pub const DISPLAY: Font = Font.of("Geist, system-ui, sans-serif")

pub const LABEL: Font = Font.of("Geist Mono, ui-monospace, monospace")
```

A style names it, and the list works as in CSS: text uses the first family that has its characters.

```silk
css.fontFamily(DISPLAY),
css.fontWeight(650.0),
css.fontSize(px(22.0)),
```

The program says where its fonts come from in `fonts`, the way a page has `@font-face` rules. `fonts.face(font, url, face)` is one rule: a file for the first family of `font`, and the weights and style it covers.

::source examples/src/core/album.silk "pub fn declareFonts"

```silk
fn fonts(model: &Album, fonts: &mut Fonts) -> () {
  declareFonts(&mut fonts)
}
```

| In `fonts` | What it is on the web |
| --- | --- |
| `fonts.face(DISPLAY, "fonts/Geist.ttf", Face.weights(100.0, 900.0))` | An `@font-face` rule |
| `fonts.stylesheet("https://fonts.googleapis.com/css2?family=Inter")` | A `<link rel="stylesheet">` of `@font-face` rules |
| `fonts.family(MONO)` | A family of installed fonts, with no rule |

Every `Font` a view uses goes in `fonts`, with `face` or `family`. A family with no face declared uses the fonts installed where the program runs. The generic names (`system-ui`, `sans-serif`, `serif`, `monospace`) are always there.

A face loads when text first needs it. Until then the text draws with the next family in the list, then lays out again, as `font-display: swap` does.

`css.fontWeight` takes any weight from 1 to 1000, as CSS does. Geist is a variable font, so one file has every weight from 100 to 900, and 650 is drawn as 650. With separate files (a regular and a bold, say), declare a face for each with `Face.weight(700.0)`, and the closest weight is used.

## The files: in a page

On a page the browser loads the pictures and the fonts, relative URLs from the app's root. Each face becomes a `FontFace` in `document.fonts`, so the page needs nothing for them.

::source examples/apps/album-web/web/index.html

The build copies the files next to the page, where the URLs point:

```sh
cp -R docs/examples/apps/album/assets/. dist/
```

Run `sh docs/examples/apps/album-web/build.sh serve` and open http://localhost:8019.

## The files: in a native window

In a window, the app's own files are part of the program. `Source.read` reads a file of the package while it compiles, and `window.file` serves it for a relative URL, so the app is one file with nothing to ship beside it. The files sit in `assets/`, next to the app's `silk.toml`.

::source examples/apps/album/src/files.silk

A relative URL the program does not carry is read from the working directory instead. The window gets the files, and `systemFonts()` is the fonts installed on the machine, for the families no face is declared for:

::source examples/apps/album/src/main.silk

::shot native-album "The same album in a window. In the docs the GPU draws it, from the same photos, icons and fonts."

Run it with `silk run --manifest-path docs/examples/apps/album/silk.toml`.

## Recap

- A view names images and icons by URL: `h.image("photos/dusk.png", attrs)`, `h.icon("icons/heart.svg", attrs)`. The scheme picks the loader; relative URLs are the app's own files.
- A page loads them like any `<img>` or `@font-face`. A native window serves the files the program carries with `window.file`, and loads `https:`, `file:` and `data:` URLs itself.
- `h.onLoad` and `h.onError` say when a picture is ready or failed.
- Icons are SVGs whose `currentColor` is the text color. Images are PNGs or JPEGs, sized with CSS and fitted with `object-fit`.
- A `Font` constant is a `font-family` list. `fonts` declares where each face comes from (`fonts.face`, `fonts.stylesheet`) and the families of installed fonts (`fonts.family`).
- `css.fontWeight` takes any weight a font has. A variable font has all of them in one file.

The tree has the same three: see [Fonts and pictures](/tree/nodes-and-styles/#fonts-and-pictures).

Next: [Events and input](/core/events/).
