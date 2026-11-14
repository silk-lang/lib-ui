# Images and fonts

A program shows photos, icons and text in fonts of its own. This page builds an album with all three: photos that are PNG and JPEG files, icons that are SVG files, and titles and labels in two fonts that ship with the app.

## An album

::demo album

Click a photo to open it, like it with the heart, search by title, or list only the ones you like.

::source examples/src/core/album.silk

## Pictures are URLs

A view never holds a file. It names a picture by URL, as an `<img>` does, and the host loads it. A relative URL is one of the app's own files.

```silk
Photo { index: 0, title: "Dusk", file: "photos/dusk.png", png: true },

pub const HEART: string<'static> = "icons/heart.svg"
```

| In the view | What it shows | The file |
| --- | --- | --- |
| `h.image("photos/dusk.png", attrs)` | A raster image | A PNG or JPEG |
| `h.icon("icons/heart.svg", attrs)` | A vector icon | An SVG |
| `css.fontFamily(DISPLAY)` | Text in a font family | TTF, OTF or WOFF2 files |

The URL's scheme says how it loads:

| URL | Loaded from |
| --- | --- |
| `photos/dusk.png` | The app's own files: next to the page, or built into a native program |
| `https://example.com/a.png` | The network, off the UI thread natively |
| `file:///home/me/a.png` | A local file (native only) |
| `data:image/png;base64,...` | The URL itself |

Each URL loads once, however many nodes show it. Until it has loaded, the node shows nothing. `h.onLoad(message)` and `h.onError(message)` say when it is ready or could not be loaded, as the DOM's `load` and `error` events do.

Fonts are still named by number for now: whoever runs the program says what each family number is.

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

A font family number stands for a CSS `font-family` list. The album uses two: Geist for titles and Geist Mono for small labels and numbers.

```silk
css.fontFamily(DISPLAY),
css.fontWeight(650.0),
css.fontSize(px(22.0)),
```

`css.fontWeight` takes any weight from 1 to 1000, as CSS does. Geist is a variable font, so one file has every weight from 100 to 900, and 650 is drawn as 650. With a family of separate files (a regular and a bold, say), add each file and the closest weight is used.

Family `1` is the default for all text, so set it too.

## The files: in a page

On a page the browser loads the pictures, relative URLs from the app's root. Fonts are loaded the way any page loads them, with `@font-face`, and `fonts` maps each family number to a `font-family` value.

::source examples/apps/album-web/web/index.html

The build copies the files next to the page, where the URLs point:

```sh
cp -R docs/examples/apps/album/assets/. dist/
```

Run `sh docs/examples/apps/album-web/build.sh serve` and open http://localhost:8019.

## The files: in a native window

In a window, the app's own files are part of the program. `Source.read` reads a file of the package while it compiles, and `window.file` serves it for a relative URL, so the app is one file with nothing to ship beside it. The files sit in `assets/`, next to the app's `silk.toml`.

::source examples/apps/album/src/files.silk

A relative URL the program does not carry is read from the working directory instead. The window gets the files and the font families, and the font collection gets the font files:

::source examples/apps/album/src/main.silk

`systemFonts()` is the fonts installed on the machine, and `add` puts the album's two files in with them. A family name in `window.font` matches the name inside the font file.

::shot native-album "The same album in a window. In the docs the GPU draws it, from the same photos, icons and fonts."

Run it with `silk run --manifest-path docs/examples/apps/album/silk.toml`.

## Recap

- A view names images and icons by URL: `h.image("photos/dusk.png", attrs)`, `h.icon("icons/heart.svg", attrs)`. The scheme picks the loader; relative URLs are the app's own files.
- A page loads them like any `<img>`. A native window serves the files the program carries with `window.file`, and loads `https:`, `file:` and `data:` URLs itself.
- `h.onLoad` and `h.onError` say when a picture is ready or failed.
- Icons are SVGs whose `currentColor` is the text color. Images are PNGs or JPEGs, sized with CSS and fitted with `object-fit`.
- Font families are numbers for now, and `css.fontWeight` takes any weight a font has. A variable font has all of them in one file.

The tree has the same three, without the numbers: see [Fonts and pictures](/tree/nodes-and-styles/#fonts-and-pictures).

Next: [Events and input](/core/events/).
