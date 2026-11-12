#!/bin/sh
# Builds the docs into docs/dist: the program, the host script, the fonts, and a page for
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
# The same program for this machine draws the pages.
silk build --manifest-path docs/silk.toml

rm -rf "$out"
mkdir -p "$out"
cp "$root/modules/app/dom/js/silk-ui-dom.js" "$out/silk-ui-dom.js"
cp "$here/web/favicon.svg" "$out/favicon.svg"
cp -R "$here/web/fonts" "$out/fonts"
cp "$root/build/llvm/wasm32-unknown-unknown/release-size/ui-docs-site" "$out/site.wasm"
host="$(ls -d "$root"/build/llvm/*/debug/ui-docs-site | grep -v wasm32 | head -1)"
"$host" "$here/web/index.html" "$out" "$base"
echo "Built $out"

if [ -n "$serve" ]; then
  cd "$out"
  exec python3 -m http.server 8017
fi
