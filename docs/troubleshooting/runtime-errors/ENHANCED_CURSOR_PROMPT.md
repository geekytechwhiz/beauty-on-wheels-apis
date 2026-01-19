# Enhanced Cursor Prompt: Runtime Module Resolution Error in NX Monorepo + AWS Serverless

## Context

You are a senior technical architect with expertise in:
- **NX Monorepo** architecture and workspace management
- **AWS Serverless** services (Lambda, API Gateway, SNS, SQS, EventBridge)
- **TypeScript** path mapping and module resolution
- **esbuild** bundling for serverless deployments
- **serverless-esbuild** plugin configuration

## Problem Statement

I have an NX monorepo with AWS Serverless services. The `user-service` application is experiencing a runtime error when deployed to AWS Lambda:

```
"errorType": "Runtime.ImportModuleError",
"errorMessage": "Error: Cannot find module 'notification'\nRequire stack:\n- /var/runtime/index.mjs",
```

**Suspected Root Cause**: Packaging/bundling issue where workspace dependencies (`@api-hub/*` packages) are not being properly bundled or resolved during serverless deployment, causing runtime module resolution failures.

## Codebase Structure

### Monorepo Layout
```
nx-apps/api-hub/
├── apps/
│   └── user-service/
│       ├── serverless.yml
│       ├── package.json
│       └── src/
│           ├── handlers/
│           ├── services/
│           │   ├── notification.service.ts
│           │   └── notification.delivery.ts
│           └── consumers/
│               └── notification.consumer.ts
├── libs/
│   ├── logger/
│   │   ├── src/index.ts
│   │   └── package.json  # exports with @api-hub/source condition
│   ├── utils/
│   ├── fhir/
│   └── error-messages/
├── tsconfig.base.json  # Contains path mappings
└── package.json  # Root workspace package.json
```

### Key Configuration Files

**`tsconfig.base.json`** defines TypeScript path mappings:
```json
{
  "compilerOptions": {
    "baseUrl": ".",
    "paths": {
      "@api-hub/logger": ["libs/logger/src/index.ts"],
      "@api-hub/utils": ["libs/utils/src/index.ts"],
      "@api-hub/fhir": ["libs/fhir/src/index.ts"],
      "@api-hub/error-messages": ["libs/error-messages/src/index.ts"]
    }
  }
}
```

**`apps/user-service/serverless.yml`** uses serverless-esbuild:
```yaml
plugins:
  - serverless-esbuild
  - serverless-dotenv-plugin
  - serverless-auto-swagger
  - serverless-offline

custom:
  esbuild:
    bundle: true
    minify: false
    sourcemap: true
    target: node18
    platform: node
    format: cjs
    tsconfig: ../../tsconfig.base.json
    external:
      - aws-sdk 
    keepNames: true
```

**Workspace packages** (`libs/*/package.json`) use conditional exports:
```json
{
  "name": "@api-hub/logger",
  "exports": {
    ".": {
      "@api-hub/source": "./src/index.ts",
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js",
      "default": "./dist/index.js"
    }
  }
}
```

## Current Implementation

### Import Patterns in user-service
- `@api-hub/logger` is imported in multiple files
- `notification.service.ts` imports from `@api-hub/logger`
- `notification.consumer.ts` imports from `@api-hub/logger` and local services

### Deployment Process
- Uses `serverless deploy` or `serverless package`
- `package.individually: true` in serverless.yml
- esbuild bundles with `bundle: true`

## Issue Analysis Required

### 1. Bundling Configuration
- **Question**: How is serverless-esbuild resolving workspace dependencies (`@api-hub/*`)?
- **Hypothesis**: esbuild is not resolving TypeScript path mappings correctly, causing workspace packages to be excluded from the bundle or incorrectly referenced.

### 2. Module Resolution
- **Question**: Why does the error reference a bare `'notification'` module?
- **Investigation**: Check if:
  - A dependency is trying to require/import `'notification'` directly
  - Path resolution is failing and falling back to a bare module name
  - Dynamic imports are not being captured by the bundler

### 3. Workspace Dependency Handling
- **Question**: Should workspace dependencies be:
  - Bundled into the Lambda function (current approach with `bundle: true`)?
  - Built separately and included as external dependencies?
  - Resolved from source files or built outputs?

### 4. Build Pipeline
- **Question**: Are workspace libraries built before serverless packaging?
- **Check**: Verify `libs/*/dist/` directories exist with built outputs.

## Specific Tasks

### Task 1: Diagnose the Root Cause
1. Review the complete `serverless.yml` configuration
2. Check how esbuild resolves `@api-hub/*` imports
3. Identify where `'notification'` module reference originates
4. Verify workspace packages are accessible during build

### Task 2: Fix Bundling Configuration
1. Configure serverless-esbuild to properly resolve workspace dependencies
2. Either:
   - Add esbuild plugins for workspace resolution
   - Use aliases to map `@api-hub/*` to source/built files
   - Ensure TypeScript path mappings are respected

### Task 3: Verify Deployment Process
1. Ensure workspace libraries are built before deployment
2. Test bundling locally with `serverless package`
3. Inspect bundled output for unresolved imports
4. Verify Lambda can execute without module resolution errors

### Task 4: Provide Solution
1. Update `serverless.yml` with correct esbuild configuration
2. Create any necessary plugin files (e.g., `esbuild-plugins.js`)
3. Update deployment scripts if needed
4. Provide testing instructions

## Constraints & Requirements

### Technical Constraints
- Must work with NX monorepo structure
- Must maintain TypeScript path mappings
- Must support conditional package exports (`@api-hub/source`)
- Must work with `serverless-esbuild` plugin
- Must support `bundle: true` approach (or provide alternative)

### Requirements
- Solution should be production-ready
- Should not require major refactoring
- Should maintain existing import patterns
- Should be testable locally before deployment

## Expected Output

1. **Root Cause Identification**: Clear explanation of why the error occurs
2. **Configuration Fix**: Updated `serverless.yml` with proper esbuild configuration
3. **Supporting Files**: Any plugins or scripts needed
4. **Deployment Steps**: Updated process for building and deploying
5. **Testing Verification**: Steps to verify the fix works

## Files to Review

1. `apps/user-service/serverless.yml` - Primary configuration file
2. `tsconfig.base.json` - TypeScript path mappings
3. `apps/user-service/package.json` - Service dependencies
4. `libs/*/package.json` - Workspace package configurations
5. `apps/user-service/src/**/*.ts` - Source files with imports
6. Deployment/build scripts (if any)

## Additional Context

- Error occurs at runtime in AWS Lambda (Node.js 22.x runtime)
- Works locally with `serverless offline` (may use different resolution)
- Monorepo uses pnpm workspace
- NX version: 22.3.3
- serverless-esbuild version: ^1.57.0

---

**Goal**: Identify and fix the packaging/bundling issue causing the `Cannot find module 'notification'` runtime error in AWS Lambda.
