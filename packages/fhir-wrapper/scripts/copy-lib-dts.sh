#!/usr/bin/env sh
set -eu

ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
OUT="$ROOT/packages/fhir-wrapper/dist"

if [ ! -f "$OUT/middleware.d.ts" ]; then
  echo "copy-lib-dts: missing $OUT/middleware.d.ts — check tsup middleware dts build" >&2
  exit 1
fi

if [ ! -f "$OUT/index.d.ts" ]; then
  echo "copy-lib-dts: missing $OUT/index.d.ts — check tsup main dts build" >&2
  exit 1
fi

echo "copy-lib-dts: ok"
