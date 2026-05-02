#!/bin/bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"
exec npx ts-node --project tools/file-import/fix-imports.tsconfig.json tools/file-import/fix-imports.ts
