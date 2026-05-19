# API-Hub Codebase — Full Reference

This document describes the **API-Hub** monorepo: structure, patterns, serverless setup, coding standards, and conventions.

---

## Table of Contents

1. [Overview](#1-overview)
2. [Repository Structure](#2-repository-structure)
3. [Workspace & Dependencies](#3-workspace--dependencies)
4. [Application Architecture](#4-application-architecture)
5. [Serverless Pattern](#5-serverless-pattern)
6. [Coding Standards & Conventions](#6-coding-standards--conventions)
7. [Libraries (libs)](#7-libraries-libs)
8. [Services (standalone)](#8-services-standalone)
9. [Tools](#9-tools)
10. [CI/CD & Build](#10-cicd--build)
11. [Documentation Map](#11-documentation-map)

---

## 1. Overview

- **Name**: `@api-hub/source`
- **Type**: Nx monorepo + pnpm workspaces
- **Runtime**: Node.js (18/20/22), AWS Lambda
- **Stack**: TypeScript, Serverless Framework, AWS (API Gateway, DynamoDB, S3, SQS, SNS, EventBridge, Cognito, Secrets Manager)
- **Purpose**: Backend APIs and services for users, organizations, devices, FHIR gateway, audit, and outbound delivery.

---

## 2. Repository Structure

```
api-hub/
├── apps/                    # Deployable applications (Lambda + API Gateway)
│   ├── user-service/        # User CRUD, org assignment, files, metadata, SQS/S3/stream
│   ├── organization-service/# Organization CRUD, links, metadata, files
│   └── device-service/       # Device registration, org/user assignment, search
├── libs/                    # Shared libraries (used by apps & services)
│   ├── logger/              # Winston-based logging, correlation ID, Lambda context
│   ├── utils/               # ApiResponse, DB config, string/object/header helpers, message resolver
│   ├── error-messages/      # Error message types and CDN integration
│   ├── fhir/                # FHIR R4 mappers, validators, profiles
│   ├── canonical/           # Canonical domain models (Patient, Observation, etc.)
│   ├── consent/             # Consent policy engine
│   ├── capability/          # Client capability registry
│   └── terminology/         # Code mapping / terminology
├── services/                # Standalone Serverless services (separate deploy)
│   ├── audit-service/       # Audit event & provenance handlers
│   ├── fhir-gateway/        # FHIR API (Patient, Observation, metadata)
│   └── outbound-delivery/   # Bulk export, subscription delivery
├── tools/                   # CLI and code-generation tools
│   └── fhir-mapper-generator/
├── docs/                    # All project documentation
│   ├── architecture/
│   ├── coding-standards/
│   ├── services/
│   ├── infrastructure/
│   └── troubleshooting/
├── pnpm-workspace.yaml      # Workspace packages: apps/*, libs/*, services/*, tools/*
├── tsconfig.base.json       # Base TS config + path aliases (@api-hub/*)
├── eslint.config.mjs        # Nx + TypeScript + module boundaries
└── package.json
```

**Conventions:**

- **apps**: Full Serverless apps (API Gateway HTTP, S3, SQS, Stream, etc.) with `serverless.yml`, `src/`, and optional `buildspec.yml` for CodeBuild.
- **libs**: No serverless; built with Nx/Vite; consumed via `@api-hub/<lib-name>` (see `tsconfig.base.json` paths).
- **services**: Lighter Serverless stacks (e.g. EventBridge/SQS handlers or HTTP API), each with its own `serverless.yml` and `src/`.

---

## 3. Workspace & Dependencies

- **Package manager**: pnpm  
- **Workspace**: `pnpm-workspace.yaml` includes `apps/*`, `libs/*`, `services/*`, `tools/*`.
- **Path aliases** (from `tsconfig.base.json`):
  - `@api-hub/logger` → `libs/logger/src/index.ts`
  - `@api-hub/utils` → `libs/utils/src/index.ts`
  - `@api-hub/error-messages`, `@api-hub/canonical`, `@api-hub/fhir`, `@api-hub/consent`, `@api-hub/capability`, `@api-hub/terminology` → respective libs.

**Key root dependencies:**  
AWS SDK v3 (DynamoDB, SNS, Cognito, Secrets Manager, EventBridge, etc.), `axios`, `zod`, `ulid`, `serverless`, `serverless-esbuild`, `serverless-offline`, `serverless-dotenv-plugin`, `serverless-auto-swagger`, `@middy/*`, `aws-lambda`, `jsonwebtoken`, `winston`.

---

## 4. Application Architecture

### 4.1 Per-app layout (e.g. user-service, organization-service, device-service)

Each app follows a consistent **layered structure**:

```
src/
├── handlers/          # Lambda entrypoints (thin: delegate to httpHandler or specific handler)
│   ├── health.ts
│   ├── createUser.ts  → exports main; calls createUser from httpHandler
│   ├── httpHandler.ts # All HTTP route logic (createUser, getUser, updateUser, etc.)
│   ├── s3/            # S3-triggered handlers
│   ├── sqs/           # SQS consumers
│   └── stream/        # DynamoDB Stream handlers
├── services/          # Business logic & external API clients
│   ├── user.service.ts      # Core user logic
│   ├── organization.service.ts  # Organization API client (HTTP)
│   ├── role.service.ts      # Role API client
│   ├── cognito.service.ts   # Cognito
│   └── notification.delivery.ts
├── repositories/      # Data access (DynamoDB, etc.)
│   ├── user.repository.ts
│   └── organization.repository.ts  # DB only; HTTP in services
├── models/            # Domain / DTO types
├── validation/        # Zod schemas (createUserSchema, updateUserSchema, etc.)
├── events/            # Event types + SNS/EventBridge publishing
├── utils/             # Errors, db.config, helpers, idempotency, response
├── consumers/         # Optional SQS/event consumers
├── index.ts           # Re-exports handlers
└── main.ts            # Optional local entry
```

**Patterns:**

- **Handlers**: Thin Lambda entrypoints; HTTP logic lives in a single `httpHandler.ts` (or similar) and is invoked by small handler files (e.g. `createUser.main` → `createUser(event, context)` from httpHandler).
- **Service vs repository**: **Repositories** = DynamoDB (and other persistence). **Services** = business logic + **external HTTP APIs** (e.g. Organization API, Role API, Cognito). Service-to-service calls use dedicated service modules (e.g. `organization.service.ts` with `getOrganization(organizationId, authHeader)`).
- **Validation**: Zod schemas in `validation/`; handlers use `schema.safeParse(body)` then `ApiResponse.unprocessableEntity` on failure.
- **Errors**: Custom classes in `utils/errors.ts` (e.g. `UserNotFoundError`, `UserAlreadyExistsError`); handlers map them to HTTP status and `ApiResponse.*`.
- **Events**: Typed envelopes in `events/event.types.ts`; publishing via `events/event.publisher.ts` (SNS/EventBridge). Optional correlation ID and request context.

See **[docs/engineering/EVENT_DRIVEN_DEVELOPMENT_GUIDE.md](engineering/EVENT_DRIVEN_DEVELOPMENT_GUIDE.md)** for `@api-hub/event-platform` + `@api-hub/middleware` consumer/producer patterns (pipelines, idempotency, retries).

---

## 5. Serverless Pattern

### 5.1 Framework and plugins

- **Framework**: Serverless Framework **3.x**
- **Provider**: AWS, `nodejs22.x` (or 20.x where specified)
- **Plugins** (typical for apps):
  - `serverless-esbuild` — bundle TypeScript, use `tsconfig.base.json`, resolve `@api-hub/*`
  - `serverless-dotenv-plugin`
  - `serverless-auto-swagger` — OpenAPI from `serverless.yml` + swagger files
  - `serverless-offline` — local HTTP simulation

### 5.2 Provider defaults (apps)

- **Region**: `us-east-1`
- **Stage**: `opt:stage` (e.g. `dev`, `stg`, `prd`)
- **Memory**: 256–512 MB
- **Timeout**: 5–30 s per function
- **Tracing**: Lambda + API Gateway (X-Ray) where enabled
- **Log retention**: 14 days
- **Package**: `individually: true`
- **Environment**: Table names, bucket names, queue ARNs, external API URLs (e.g. `ORGANIZATION_API_URL`, `ROLE_API_URL`) from `custom.stageUrls.${stage}`

### 5.3 Function definition pattern

```yaml
functions:
  health:
    handler: src/handlers/health.main
    events:
      - http:
          path: /health
          method: get
          cors: ...
          documentation: ...
  createUser:
    handler: src/handlers/createUser.main
    timeout: 10
    memorySize: 256
    events:
      - http:
          path: user
          method: post
          cors: ...
          documentation: ...
```

- **Handler path**: `src/handlers/<module>.<export>` (e.g. `main` or `handler`).
- **HTTP**: API Gateway REST (apps) or `httpApi` (e.g. fhir-gateway).
- **CORS**: From `custom.cors` (origin, headers including `Authorization`, `X-Correlation-Id`).

### 5.4 Custom config (apps)

- **esbuild**: `bundle: true`, `sourcemap: true`, `target: node18/node22`, `platform: node`, `format: cjs`, `external: ['aws-sdk']`, custom plugins for Nx path resolution.
- **stageUrls**: Per-stage URLs for ORGANIZATION_API_URL, ROLE_API_URL, PORTAL_LINK, WEB_URL, etc.
- **logLevel**: Per-stage (e.g. dev: debug, prd: warn).
- **autoswagger**: Title, basePath, schemes, swagger files, tags.

### 5.5 IAM

- **iamRoleStatements** in `serverless.yml`: least-privilege per resource (DynamoDB tables/indexes, S3 buckets, SQS queues, SNS topics, EventBridge bus, Lambda invoke, Cognito, Secrets Manager, X-Ray).

### 5.6 Services vs apps

- **apps** (user-service, organization-service, device-service): Full REST APIs, many functions, DynamoDB, S3, SQS, SNS, EventBridge, Cognito.
- **services/audit-service**: Few Lambda handlers (audit event, provenance), minimal IAM.
- **services/fhir-gateway**: `httpApi` routes for FHIR (Patient, Observation, metadata), serverless-esbuild, Nx path resolution.

---

## 6. Coding Standards & Conventions

### 6.1 API responses

- **Library**: `@api-hub/utils` exposes **ApiResponse** (and related types).
- **Unified shape**: `success`, `statusCode`, `message` (object with title/description/severity or resolved from CDN), `data`, `error`, `meta` (requestId, timestamp, version).
- **Usage**: Prefer **message keys** (e.g. `USER.USER_CREATED_SUCCESS`, `COMMON.VALIDATION_ERROR`) so messages are resolved from CDN; pass `{ requestId: correlationId, event }` when needed for language.
- **Examples**:
  - Success: `ApiResponse.ok(data, 'USER.USER_RETRIEVED_SUCCESS', { requestId, event })`
  - Created: `ApiResponse.created({ userID }, 'USER.USER_CREATED_SUCCESS', { requestId, event })`
  - Validation: `ApiResponse.unprocessableEntity('COMMON.VALIDATION_ERROR', { requestId, event }, { code: 'VALIDATION_ERROR', details })`
  - Not found: `ApiResponse.notFound('USER.USER_NOT_FOUND', { requestId, event }, { code: 'USER_NOT_FOUND', details })`
  - Bad request: `ApiResponse.badRequest('ORGANIZATION.NOT_FOUND', ..., { code: 'ORGANIZATION_NOT_FOUND', details })`

See: `docs/coding-standards/README.md` and `docs/coding-standards/api-response/API_RESPONSE_USAGE.md`.

### 6.2 Message keys

- Format: `MODULE.MESSAGE_CODE` (e.g. `USER.USER_CREATED_SUCCESS`, `ORGANIZATION.NOT_AVAILABLE`).
- Kept in sync with CDN / message resolver where used.

### 6.3 Logging

- **Library**: `@api-hub/logger` (createLogger, createChildLogger, serializeError, createPerformanceTimer, extractCorrelationId, extractAwsRequestId, logHttpRequest).
- **Pattern**: Base logger per service; child loggers with `correlationId`, `userId`, `organizationId`, etc. Log structured objects (`event: 'createUser_received'`) for searchability.
- **PII**: Logger created with `redactPII: true` where applicable.

### 6.4 Validation

- **Zod** in `validation/*.ts`: e.g. `createUserSchema`, `updateUserSchema`, `assignUserToOrganizationSchema`.
- Handlers: `schema.safeParse(body)` then either use `validation.data` or return `ApiResponse.unprocessableEntity` with `validation.error.issues` mapped to `field`/`message`.

### 6.5 Errors

- Custom errors in `utils/errors.ts`: `UserNotFoundError`, `UserAlreadyExistsError`, `OrganizationNotFoundError`, `ValidationError`, `InvalidEventError`.
- Handlers catch and map to status codes and `ApiResponse.*` (e.g. 404 for `UserNotFoundError`, 409 for `UserAlreadyExistsError`).

### 6.6 TypeScript

- **Strict**: `strict: true` in base config.
- **Target**: ES2022; module ESNext; moduleResolution bundler.
- **Paths**: Use `@api-hub/*` for libs; avoid relative paths across packages.

### 6.7 ESLint

- **Config**: `eslint.config.mjs` (flat config), Nx base + TypeScript + `@nx/enforce-module-boundaries`.
- **Boundaries**: Apps tagged `type:app` depend on libs with `allowed-for-app`; services `type:service` depend on `type:lib`; libs depend on `type:lib`.

---

## 7. Libraries (libs)

| Library | Purpose |
|--------|---------|
| **logger** | Winston logger, child loggers, correlation ID, Lambda context, serializeError, performance timers |
| **utils** | ApiResponse, DB client helpers, stringUtils, objectUtils, headerUtils, messageResolver, response types |
| **error-messages** | Error message types and CDN integration |
| **fhir** | FHIR R4 mappers (canonical → FHIR), validators, profiles |
| **canonical** | Canonical domain models (e.g. Patient, DeviceReading, ObservationValue) |
| **consent** | Consent policy engine (evaluateConsent) |
| **capability** | Client capability registry (getClientCapability) |
| **terminology** | Code mapping / terminology |

Build: `nx build <lib-name>`. Consumed via `@api-hub/<lib-name>` in apps and services.

---

## 8. Services (standalone)

| Service | Role |
|--------|------|
| **audit-service** | Lambda handlers for audit events and provenance (stubs); serverless-esbuild |
| **fhir-gateway** | FHIR REST API (Patient, Observation, metadata); serverless-offline; uses libs (fhir, canonical, etc.) |
| **outbound-delivery** | Bulk export and subscription delivery handlers |

Each has its own `serverless.yml` and is deployed independently (e.g. `cd services/fhir-gateway && serverless deploy`).

---

## 9. Tools

- **fhir-mapper-generator**: CLI and code generation for FHIR mapping (config-driven, serverless-parser, templates). See `tools/fhir-mapper-generator/README.md`.

---

## 10. CI/CD & Build

- **Buildspecs**: Apps may have `buildspec.yml`, `stg-buildspec.yml`, `prd-buildspec.yml` (CodeBuild): install Node, serverless, dependencies; run `serverless package`; CloudFormation package to S3; deploy.
- **Deploy**: Per-app or per-service (e.g. `cd apps/user-service && serverless deploy --stage dev`).
- **Local**: e.g. `user-service:offline`: `cd apps/user-service && serverless offline --stage dev`.
- **Nx**: `project.json` per app/lib (e.g. build with `@nrwl/node:build`, test with Jest). Some apps reference `@nrwl/jest` (legacy).

---

## 11. Documentation Map

| Area | Location |
|------|----------|
| **Docs index** | `docs/README.md` |
| **Event-driven guide** | `docs/engineering/EVENT_DRIVEN_DEVELOPMENT_GUIDE.md` |
| **Architecture** | `docs/architecture/system-architecture.md` |
| **Coding standards** | `docs/coding-standards/README.md`, `docs/coding-standards/api-response/` |
| **API response usage** | `docs/coding-standards/api-response/API_RESPONSE_USAGE.md` |
| **Message keys** | `docs/coding-standards/api-response/MESSAGE_KEYS_CONVENTION.md` |
| **Doc structure** | `docs/DOCUMENTATION_STRUCTURE.md` |
| **Services** | `docs/services/` (organization, device, fhir-gateway: requirements, prompts, implementation) |
| **Infrastructure** | `docs/infrastructure/` (CDN, unified response) |
| **Troubleshooting** | `docs/troubleshooting/` (runtime errors, production fixes) |
| **Logger** | `libs/logger/README.md` |

---

## Quick reference

- **Add a new HTTP route**: Add function in `serverless.yml` → handler file → implement or delegate in `httpHandler.ts`.
- **Call another service**: Put HTTP client in `services/<name>.service.ts` (e.g. `organization.service.ts`), call from business logic; pass `authHeader` when needed.
- **New DynamoDB access**: Add or extend a `repositories/<entity>.repository.ts`; keep HTTP calls in `services/`.
- **Validate request body**: Add or reuse Zod schema in `validation/`, use `safeParse` in handler and return `ApiResponse.unprocessableEntity` on failure.
- **Return response**: Use `ApiResponse.*` from `@api-hub/utils` with message keys and `{ requestId, event }` where applicable.
- **Log**: Use `@api-hub/logger` with child loggers and structured `event` keys.

---

*This codebase README is maintained alongside the repo. For Nx workspace usage, see the root [README.md](../README.md).*
