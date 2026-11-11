#!/bin/sh
# Builds the site into modules/app/site/build: the page, the host script and the program.
# `./build.sh serve` then serves it on http://localhost:8017.
set -e
here="$(cd "$(dirname "$0")" && pwd)"
root="$(cd "$here/../../.." && pwd)"
out="$here/build"

cd "$root"
silk build --manifest-path modules/app/site/silk.toml \
  --profile-input '{"target":"wasm32-unknown-unknown","optimization":"none","debug":true,"stackSize":"8MiB"}'

mkdir -p "$out"
cp "$here/web/index.html" "$out/index.html"
cp "$here/../dom/js/silk-ui-dom.js" "$out/silk-ui-dom.js"
cp "$root/build/llvm/wasm32-unknown-unknown/debug/ui-app-site" "$out/site.wasm"
echo "Built $out"

if [ "$1" = "serve" ]; then
  cd "$out"
  exec python3 -m http.server 8017
fi
