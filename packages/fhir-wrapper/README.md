# @myvitalrx/fhir-wrapper

FHIR R4 transformation, mapping, validation, and `withApiHandler` middleware for MyVitalRx serverless APIs.

| Subpath | Role |
|---------|------|
| `@myvitalrx/fhir-wrapper` | FHIR transformation, mapping, validation |
| `@myvitalrx/fhir-wrapper/middleware` | `withApiHandler` FHIR projection (lazy-loaded by platform-tools middleware) |

Utils and terminology are **bundled** (no separate `@api-hub/utils` install). Observability types/runtime used by FHIR error handling come from **`@myvitalrx/platform-tools/observability`** — install both packages when using middleware + FHIR.

---

## Install

```bash
pnpm add @myvitalrx/platform-tools @myvitalrx/fhir-wrapper
```

`@myvitalrx/platform-tools` is a **peer dependency** (required for `withApiHandler` and observability).

---

## Quick imports

```ts
import { transformToFhirResponse } from '@myvitalrx/fhir-wrapper';
import {
  isFhirEnabled,
  transformToFhirResponse as toFhir,
} from '@myvitalrx/fhir-wrapper/middleware';
```

For HTTP handlers, use `withApiHandler` from `@myvitalrx/platform-tools/middleware` with the `fhir` option — see [FHIR quick-start](../../docs/fhir/WITH_API_HANDLER_QUICKSTART.md).

---

## Monorepo build

```bash
nx build fhir fhir-wrapper
# or
pnpm run build:fhir-wrapper
```

---

## Publish to npm

```bash
export NPM_TOKEN=...   # repo-root .env — never commit
cd packages/fhir-wrapper && npm publish --access public --userconfig=../../.npmrc
```

```bash
pnpm run publish:fhir-wrapper   # from repo root
```
