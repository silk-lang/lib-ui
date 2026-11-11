#!/bin/sh
# Builds the site into modules/app/site/build: the program, the host script, and a page for
# every route, rendered ahead and hydrated by the program when it loads.
#
#   ./build.sh                 a site at the root of its origin
#   ./build.sh --base /docs    a site under /docs
#   ./build.sh serve           builds, then serves it on http://localhost:8017
set -e
here="$(cd "$(dirname "$0")" && pwd)"
root="$(cd "$here/../../.." && pwd)"
out="$here/build"
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
silk build --manifest-path modules/app/site/silk.toml \
  --profile-input '{"target":"wasm32-unknown-unknown","optimization":"none","debug":true,"stackSize":"8MiB"}'
silk build --manifest-path modules/app/site/silk.toml

rm -rf "$out"
mkdir -p "$out"
cp "$here/../dom/js/silk-ui-dom.js" "$out/silk-ui-dom.js"
cp "$here/web/chevron.svg" "$out/chevron.svg"
cp "$root/build/llvm/wasm32-unknown-unknown/debug/ui-app-site" "$out/site.wasm"
host="$(ls -d "$root"/build/llvm/*/debug/ui-app-site | /usr/bin/grep -v wasm32 | head -1)"
"$host" "$here/web/index.html" "$out" "$base"
echo "Built $out"

if [ -n "$serve" ]; then
  cd "$out"
  exec python3 -m http.server 8017
fi
