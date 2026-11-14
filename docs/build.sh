#!/bin/sh
# Builds the docs into docs/dist: the program, the host script, the fonts, the pictures, and a page for
# every route, drawn ahead of time and hydrated by the program when it loads.
#
#   docs/build.sh                 a site at the root of its origin
#   docs/build.sh --base /docs    a site under /docs
#   docs/build.sh serve           builds, then serves it on http://localhost:8017
set -e
here="$(cd "$(dirname "$0")" && pwd)"
root="$(cd "$here/.." && pwd)"
out="$here/dist"
base=""
serve=""
while [ $# -gt 0 ]; do
  case "$1" in
    --base) base="${2%/}"; shift ;;
    serve) serve=1 ;;
  esac
  shift
done

cd "$root"
# The program is downloaded by every reader, so it is built for size, without debug information.
silk build --manifest-path docs/silk.toml \
  --profile-input '{"target":"wasm32-unknown-unknown","optimization":"size","debug":false,"stackSize":"8MiB"}'
# The window examples for a WebGPU canvas: the pages run them where a browser can.
silk build --manifest-path docs/live/silk.toml \
  --profile-input '{"target":"wasm32-unknown-unknown","optimization":"size","debug":false,"stackSize":"8MiB"}'
# The same program for this machine draws the pages.
silk build --manifest-path docs/silk.toml
# The pictures: the example programs, run with no window and drawn on the CPU.
silk build --manifest-path docs/shots/silk.toml
silk build --manifest-path docs/examples/apps/tree-hello/silk.toml

rm -rf "$out"
mkdir -p "$out"
cp "$root/modules/app/dom/js/silk-ui-dom.js" "$out/silk-ui-dom.js"
cp "$here/web/favicon.svg" "$out/favicon.svg"
cp -R "$here/web/fonts" "$out/fonts"
# The album's photos and icons, at the root as its relative URLs name them, and its fonts.
cp -R "$here/examples/apps/album/assets/photos" "$out/photos"
cp -R "$here/examples/apps/album/assets/icons" "$out/icons"
mkdir -p "$out/album"
cp -R "$here/examples/apps/album/assets/fonts" "$out/album/fonts"
cp "$root/build/llvm/wasm32-unknown-unknown/release-size/ui-docs-site" "$out/site.wasm"
debug="$(ls -d "$root"/build/llvm/*/debug | grep -v wasm32 | head -1)"
mkdir -p "$out/shots"
"$debug/ui-docs-shots" "$out/shots"
(cd "$out/shots" && "$debug/tree-hello" && mv hello.png tree-hello.png)

# The running examples: the module, the canvas host of ui-tree-window, and the window and WebGPU
# hosts of lib-native it imports. A static server gives a .ts file the wrong type, and the
# imports name paths from a development server's root, so both are rewritten on the way.
# lib-native is where Silk's Git cache put it, at the revisions docs/live/silk.toml pins.
cache="${SILK_HOME:-$HOME/.silk}/git"
pin() { sed -n "s/^$1 = .*rev = \"\([0-9a-f]*\)\".*/\1/p" "$here/live/silk.toml"; }
windows="$cache/$(pin window)/modules/platform/window/browser"
webgpu="$cache/$(pin webgpu)/modules/gpu/webgpu/browser"
mkdir -p "$out/live/window" "$out/live/webgpu"
cp "$here/web/live.html" "$out/live/index.html"
cp "$root/build/llvm/wasm32-unknown-unknown/release-size/ui-docs-live" "$out/live/app.wasm"
sed -e "s|'/native/platform/window/browser/window-host.js'|'./window/window-host.js'|" \
  -e "s|'/native/gpu/webgpu/browser/host.ts'|'./webgpu/host.js'|" \
  "$root/modules/tree/window/browser/app-host.js" > "$out/live/app-host.js"
for file in window-host imports keys; do
  cp "$windows/$file.js" "$out/live/window/$file.js"
done
for file in host generated_schema; do
  sed -e "s|\./generated_schema\.ts|./generated_schema.js|" \
    "$webgpu/$file.ts" > "$out/live/webgpu/$file.js"
done

host="$(ls -d "$root"/build/llvm/*/debug/ui-docs-site | grep -v wasm32 | head -1)"
"$host" "$here/web/index.html" "$out" "$base"
echo "Built $out"

if [ -n "$serve" ]; then
  cd "$out"
  exec python3 -m http.server 8017
fi
