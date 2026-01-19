# Production Fix: "Cannot find module 'notification'" Runtime Error

## Problem
Runtime error in AWS Lambda: `Runtime.ImportModuleError: Error: Cannot find module 'notification'` when the notificationConsumer function executes.

## Root Cause
The error occurs because serverless-esbuild is not properly bundling NX workspace dependencies (`@api-hub/*` packages). When esbuild processes the code, workspace package imports may not be resolved correctly, leading to runtime module resolution failures.

## Solution Implemented

### 1. Esbuild Plugin Configuration ✅
Created/updated `apps/user-service/esbuild-plugins.js` to resolve workspace dependencies from source files.

### 2. Build Workspace Dependencies ✅
Workspace libraries must be built before deployment:
```bash
nx run logger:build
nx run utils:build
nx run error-messages:build
nx run fhir:build
```

### 3. Serverless Configuration ✅
The `serverless.yml` already has the correct esbuild configuration with the plugin.

## Next Steps for Deployment

### Step 1: Build Workspace Dependencies
```bash
cd /Applications/Utilities/projects/nx-apps/api-hub
nx run logger:build
nx run utils:build
nx run error-messages:build
nx run fhir:build
```

### Step 2: Package and Test Locally
```bash
cd apps/user-service
serverless package
serverless offline
```

### Step 3: Deploy
```bash
serverless deploy --stage dev
```

## If Error Persists

If the error still occurs after the above steps, try these additional fixes:

### Alternative Fix 1: Verify Handler Path
The handler path `src/consumers/notification.consumer.handler` should resolve to:
- File: `src/consumers/notification.consumer.ts`
- Export: `handler`

Verify the file exists and exports `handler` correctly.

### Alternative Fix 2: Check Bundled Output
```bash
cd apps/user-service
serverless package
unzip -l .serverless/notificationConsumer.zip | grep handler.js
# Inspect the bundled handler.js file for unresolved imports
```

### Alternative Fix 3: Add Explicit External Configuration
If workspace packages are still not being bundled, you may need to ensure they're not marked as external:

```yaml
custom:
  esbuild:
    bundle: true
    external:
      - aws-sdk
      # DO NOT add @api-hub/* packages here - they should be bundled
```

### Alternative Fix 4: Use Built Outputs
If source file resolution doesn't work, ensure workspace packages are built and point to dist files:

Update `esbuild-plugins.js` to prefer built outputs:
```javascript
const builtPath = resolve(workspaceRoot, `libs/${packageName.replace('@api-hub/', '')}/dist/index.js`);
const sourcePath = resolve(workspaceRoot, `libs/${packageName.replace('@api-hub/', '')}/src/index.ts`);
const resolvedPath = existsSync(builtPath) ? builtPath : sourcePath;
```

## Files Modified
- ✅ `apps/user-service/esbuild-plugins.js` - Workspace dependency resolver
- ✅ Workspace libraries built (logger, utils, etc.)

## Testing Checklist
- [ ] Workspace dependencies are built
- [ ] `serverless package` completes without errors
- [ ] Bundled output has no unresolved imports
- [ ] `serverless offline` works correctly
- [ ] Lambda function deploys successfully
- [ ] CloudWatch logs show no module resolution errors
- [ ] Notification consumer executes without errors
