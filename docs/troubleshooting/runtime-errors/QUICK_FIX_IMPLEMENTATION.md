# Quick Fix Implementation Guide

## Problem
Runtime error: `Cannot find module 'notification'` in AWS Lambda when using NX monorepo with serverless-esbuild.

## Root Cause
serverless-esbuild is not properly resolving workspace dependencies (`@api-hub/*` packages) defined in TypeScript path mappings. The bundler either:
1. Fails to resolve these imports correctly
2. Leaves them unresolved, causing runtime module resolution failures

## Solution Implemented

### 1. Created esbuild plugin (`apps/user-service/esbuild-plugins.js`)
This plugin intercepts imports of `@api-hub/*` packages and resolves them to their source files (or built outputs if available).

### 2. Updated serverless.yml
Added plugin configuration and resolveExtensions to ensure proper module resolution.

## Steps to Apply Fix

### Step 1: Verify Workspace Dependencies are Built
```bash
# From workspace root
nx run logger:build
nx run utils:build
nx run fhir:build
nx run error-messages:build

# Or build all workspace libraries
nx run-many -t build --projects=tag:scope:shared
```

### Step 2: Test Bundling Locally
```bash
cd apps/user-service

# Test package bundling
serverless package

# Inspect the bundled output (optional)
# Check .serverless/<function-name>/handler.js for correct imports
```

### Step 3: Test Locally with Offline
```bash
cd apps/user-service
serverless offline
# Test your endpoints to ensure everything works
```

### Step 4: Deploy to Dev Environment
```bash
cd apps/user-service
serverless deploy --stage dev
```

### Step 5: Verify in AWS
1. Check CloudWatch logs for the deployed Lambda functions
2. Test the API endpoints
3. Confirm no module resolution errors

## Files Modified

1. ✅ `apps/user-service/esbuild-plugins.js` - NEW FILE
   - Resolves `@api-hub/*` workspace packages to source/built files

2. ✅ `apps/user-service/serverless.yml` - UPDATED
   - Added `plugins: esbuild-plugins.js`
   - Added `resolveExtensions` for proper module resolution

## Additional Recommendations

### Pre-Deployment Build Script
Create `apps/user-service/pre-deploy.sh`:
```bash
#!/bin/bash
set -e

echo "Building workspace dependencies..."
cd "$(dirname "$0")/../.."

nx run logger:build
nx run utils:build
nx run fhir:build
nx run error-messages:build

echo "Workspace dependencies built successfully"
```

Make it executable:
```bash
chmod +x apps/user-service/pre-deploy.sh
```

### CI/CD Integration
Ensure your CI/CD pipeline builds workspace dependencies before serverless deployment:

```yaml
# Example GitHub Actions / GitLab CI
- name: Build workspace dependencies
  run: |
    nx run-many -t build --projects=tag:scope:shared

- name: Deploy serverless
  run: |
    cd apps/user-service
    serverless deploy --stage ${{ env.STAGE }}
```

## Troubleshooting

### If the error persists:

1. **Check plugin file path**:
   - Ensure `esbuild-plugins.js` is in `apps/user-service/`
   - Verify the path in `serverless.yml` is correct

2. **Verify workspace packages exist**:
   ```bash
   ls -la libs/logger/src/index.ts
   ls -la libs/utils/src/index.ts
   # etc.
   ```

3. **Check bundled output**:
   ```bash
   serverless package
   # Look for unresolved @api-hub/* imports in .serverless/*/handler.js
   ```

4. **Enable verbose logging**:
   ```yaml
   custom:
     esbuild:
       logLevel: verbose
   ```

5. **Alternative: Use built outputs explicitly**:
   If source files aren't resolving, ensure all workspace packages are built first, and the plugin will prefer `dist/index.js` files.

## Expected Behavior After Fix

- ✅ Workspace dependencies (`@api-hub/logger`, etc.) are properly bundled
- ✅ No runtime module resolution errors
- ✅ Lambda functions execute successfully
- ✅ All imports resolve correctly

## Rollback Plan

If issues occur, you can revert:

1. Remove `plugins: esbuild-plugins.js` from `serverless.yml`
2. Remove the `resolveExtensions` configuration
3. Delete `esbuild-plugins.js`

However, you'll need an alternative solution (see `RUNTIME_IMPORT_ERROR_ANALYSIS.md` for alternatives).
