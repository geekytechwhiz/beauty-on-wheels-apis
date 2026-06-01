#!/usr/bin/env sh
set -eu

ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
OUT="$ROOT/packages/platform-tools/dist"

EP_DTS="$ROOT/libs/event-platform/dist/index.d.ts"
EP_DIST="$ROOT/libs/event-platform/dist"
FHIR_TYPES_SRC="$ROOT/dist/libs/fhir"

for f in middleware event-platform-dx observability; do
  if [ ! -f "$OUT/$f.d.ts" ]; then
    echo "copy-lib-dts: missing $OUT/$f.d.ts — check tsup dts build" >&2
    exit 1
  fi
done

if [ ! -f "$OUT/fhir/middleware.d.ts" ]; then
  echo "copy-lib-dts: missing $OUT/fhir/middleware.d.ts — check tsup dts build" >&2
  exit 1
fi

if [ ! -f "$FHIR_TYPES_SRC/index.d.ts" ]; then
  echo "copy-lib-dts: missing $FHIR_TYPES_SRC/index.d.ts — run: nx build fhir" >&2
  exit 1
fi

if [ ! -f "$EP_DTS" ]; then
  echo "copy-lib-dts: missing $EP_DTS — run: nx build event-platform" >&2
  exit 1
fi

# FHIR full-surface types reference ./mapper, ./services, etc. — copy as a self-contained tree.
FHIR_TYPES="$OUT/fhir-types"
rm -rf "$FHIR_TYPES"
mkdir -p "$FHIR_TYPES"
cp -R "$FHIR_TYPES_SRC/." "$FHIR_TYPES/"

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
