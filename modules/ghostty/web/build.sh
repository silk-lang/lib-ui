#!/bin/sh
# Builds the page into dist/ and, with `serve`, serves it on http://localhost:8019.
# Needs the WebAssembly libghostty-vt first: `python3 modules/ghostty/vt/scripts/prepare --wasm`.
set -e
here="$(cd "$(dirname "$0")" && pwd)"
root="$(cd "$here/../../.." && pwd)"

cd "$root"
silk build --manifest-path "$here/silk.toml" \
  --profile-input '{"target":"wasm32-unknown-unknown","optimization":"size","debug":false}'

rm -rf "$here/dist"
mkdir -p "$here/dist"
cp "$here/build/llvm/wasm32-unknown-unknown/release-size/ui-ghostty-web" "$here/dist/terminal.wasm"
cp "$root/modules/app/dom/js/silk-ui-dom.js" "$here/dist/silk-ui-dom.js"
cp "$here/web/index.html" "$here/dist/index.html"
echo "Built $here/dist"

if [ "$1" = "serve" ]; then
  cd "$here/dist"
  exec python3 -m http.server 8019
fi
