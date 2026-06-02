#!/usr/bin/env sh
set -eu

ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
OUT="$ROOT/packages/platform-tools/dist"

EP_DTS="$ROOT/libs/event-platform/dist/index.d.ts"
EP_DIST="$ROOT/libs/event-platform/dist"

for f in middleware event-platform-dx observability; do
  if [ ! -f "$OUT/$f.d.ts" ]; then
    echo "copy-lib-dts: missing $OUT/$f.d.ts — check tsup dts build" >&2
    exit 1
  fi
done

if [ ! -f "$EP_DTS" ]; then
  echo "copy-lib-dts: missing $EP_DTS — run: nx build event-platform" >&2
  exit 1
fi

# Event-platform types reference ./lib, ./sdk, ./core, ./typings — copy as a self-contained tree.
EP_TYPES="$OUT/event-platform"
rm -rf "$EP_TYPES"
mkdir -p "$EP_TYPES"
cp "$EP_DTS" "$EP_TYPES/index.d.ts"
for dir in lib sdk core typings adapters engine infra utils; do
  if [ -d "$EP_DIST/$dir" ]; then
    cp -R "$EP_DIST/$dir" "$EP_TYPES/"
  fi
done

echo "copy-lib-dts: ok"
