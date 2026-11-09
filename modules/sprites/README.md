# ui-sprites

SVG icons and decoded images as [graphics-atlas](https://github.com/silk-lang/lib-graphics/tree/main/modules/atlas) tiles, for the UI scene's glyph and
image sprites. This is phase 6 of the UI drawing layer. It holds no GPU code: like the glyph
cache in [font-raster](https://github.com/silk-lang/lib-fonts/tree/main/modules/raster), it allocates tiles and queues their pixels, and the
renderer copies the queued pixels into its textures (`queue.writeTexture` on WebGPU,
`AtlasPixels.write` for the CPU reference).

- `icons.IconCache` renders SVG icons with [svg_render](https://github.com/silk-lang/lib-svg/tree/main/modules/render) at the device
  pixel size they are drawn at. `register(data, host)` parses an icon once;
  `icon(atlas, host, id, width, height, style, time)` returns its tile, rendering on a miss.
  `IconStyle.Mask` keeps the rendering's alpha in a monochrome tile, to draw tinted as a
  `GlyphSprite` (what GPUI does with its icons); `IconStyle.Color` keeps premultiplied RGBA in a
  polychrome tile, to draw as an `ImageSprite`.
- Animated icons (SMIL elements, or a `@keyframes` rule) are cached per frame: the time rounds
  to `IconOptions.framesPerSecond` (60 by default) and each frame number is its own tile. The
  atlas evicts frames that stop being drawn; `prune(atlas)` drops their entries. Frames come
  from `svg_render.lib.Animated`, so the document is parsed once and its images decoded once.
  This suits small animated icons; a large animated SVG should be lowered into `gpu_scene`
  instead (`modules/gpu`), which keeps no texture per frame.
- `images.ImageStore` decodes PNG and JPEG files once with `codec.decode.decodeSrgb` (ICC
  profiles and PNG gamma converted to sRGB, EXIF orientation applied) or takes samples made
  elsewhere with `insert`. `tile(atlas, id)` uploads an image the first time it is drawn and only
  touches its tile afterwards. The store keeps the samples, so an image whose tile was evicted is
  uploaded again without being decoded again. `remove` frees both; ids carry a generation and go
  stale.
- `uploads.Upload` has the same shape as font-raster's (`tile`, `offset`, `bytesPerRow`), so a
  renderer copies glyphs, icons and images the same way.

## A frame

```silk
drop atlas.beginFrame()

// A 16 px icon at 2x, tinted like text.
let tile = run icons.icon(&mut atlas, &host, close, 32, 32, IconStyle.Mask, now)
// A GlyphSprite over the icon's bounds, sampling `tile`, in the text color.

// A photo, uploaded on its first frame only.
if let Option<AtlasTile>.Some { value } = run images.tile(&mut atlas, photo) {
  // An ImageSprite over the image's bounds, sampling `value`.
}

// After the scene is built: create new atlas textures, then copy the uploads.
copy(icons.uploads(), icons.uploadBytes())
copy(images.uploads(), images.uploadBytes())
icons.clearUploads()
images.clearUploads()
```

Every icon call must pass the `host` its icon was registered with. With an animated processing
mode (`ProcessingMode.Animated`) in the host's structure options, icons animate; with a static
mode they render at time zero.

## Tests

```sh
silk test --manifest-path modules/sprites/silk.toml --root src/tests.silk
```

The icon tests check that color tiles equal `svg_render.lib.render` at the same size byte for
byte and mask tiles equal its alpha channel, at square and non-square sizes; that hits render and
upload nothing; that animation times round to frames, with each frame equal to a fresh render at
the frame's time, for SMIL and CSS Animations; and that frames the atlas evicted are pruned and
rendered again. The image tests check that a decoded image is uploaded once with its decoded
samples, uploaded again from the kept samples after eviction, refused when larger than the
atlas's largest texture, and that removed ids go stale.
