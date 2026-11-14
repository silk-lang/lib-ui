#!/bin/sh
# Builds the entry into the js-framework-benchmark checkout at $1 (frameworks/keyed/silk-ui).
set -e
here="$(cd "$(dirname "$0")" && pwd)"
root="$(cd "$here/../../.." && pwd)"
target="${1:?usage: build.sh <js-framework-benchmark checkout>}/frameworks/keyed/silk-ui"
optimization="${OPTIMIZATION:-speed}"

# The linker's default stack is 1 MiB, which a page holds from the start whether it uses it or
# not. The entry runs in 64 KiB (10,000 rows), so 256 KiB leaves room.
cd "$root"
silk build --manifest-path "$here/silk.toml" \
  --profile-input "{\"target\":\"wasm32-unknown-unknown\",\"optimization\":\"$optimization\",\"debug\":false,\"stack-size\":\"256KiB\"}"

profile=release
[ "$optimization" = "size" ] && profile=release-size
mkdir -p "$target/dist"
cp "$here/page/index.html" "$here/page/package.json" "$here/page/package-lock.json" "$target/"
cp "$root/build/llvm/wasm32-unknown-unknown/$profile/ui-bench-web" "$target/dist/bench.wasm"
cp "$root/modules/app/dom/js/silk-ui-dom.js" "$target/dist/silk-ui-dom.js"
echo "Built $target"
