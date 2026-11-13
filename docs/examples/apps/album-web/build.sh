#!/bin/sh
# Builds the page into dist/ and, with `serve`, serves it on http://localhost:8019.
set -e
here="$(cd "$(dirname "$0")" && pwd)"
root="$(cd "$here/../../../.." && pwd)"

cd "$root"
silk build --manifest-path "$here/silk.toml" \
  --profile-input '{"target":"wasm32-unknown-unknown","optimization":"size","debug":false}'

rm -rf "$here/dist"
mkdir -p "$here/dist"
cp "$root/build/llvm/wasm32-unknown-unknown/release-size/album-web" "$here/dist/album.wasm"
cp "$root/modules/app/dom/js/silk-ui-dom.js" "$here/dist/silk-ui-dom.js"
cp "$here/web/index.html" "$here/dist/index.html"
# The photos, icons and fonts the native album builds in, beside the page that names them.
cp -R "$here/../album/assets" "$here/dist/assets"
echo "Built $here/dist"

if [ "$1" = "serve" ]; then
  cd "$here/dist"
  exec python3 -m http.server 8019
fi
