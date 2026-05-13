# Runtime ImportModuleError Analysis: "Cannot find module 'notification'"

## Executive Summary

**Error**: `Runtime.ImportModuleError: Error: Cannot find module 'notification'`  
**Root Cause**: serverless-esbuild is not properly bundling/resolving NX monorepo workspace dependencies, causing runtime module resolution failures in AWS Lambda.

---

## Problem Analysis

### 1. Current Configuration Issues

#### serverless.yml Configuration (lines 130-140)
```yaml
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

**Issues Identified:**
1. **Workspace Dependencies Not Handled**: The `external` array only contains `aws-sdk`, but workspace packages like `@api-hub/logger`, `@api-hub/utils`, etc. are not being bundled or marked as external.
2. **Path Resolution**: TypeScript path mappings in `tsconfig.base.json` are not being resolved by esbuild during bundling.
3. **Missing Resolver Configuration**: serverless-esbuild doesn't know how to resolve workspace dependencies from `libs/`.

### 2. NX Monorepo Structure Impact

The project uses:
- **Workspace packages**: `@api-hub/logger`, `@api-hub/utils`, `@api-hub/fhir`, `@api-hub/error-messages`
- **TypeScript path mappings** in `tsconfig.base.json`:
  ```json
  "paths": {
    "@api-hub/logger": ["libs/logger/src/index.ts"],
    "@api-hub/utils": ["libs/utils/src/index.ts"],
    "@api-hub/fhir": ["libs/fhir/src/index.ts"],
    "@api-hub/error-messages": ["libs/error-messages/src/index.ts"]
  }
  ```
- **Package exports** with conditional exports (`@api-hub/source` condition)

### 3. Why the Error Occurs

When `bundle: true` is set, esbuild attempts to bundle all dependencies. However:
1. Workspace dependencies using TypeScript path aliases may not resolve correctly.
2. At runtime, Node.js tries to resolve `@api-hub/*` packages, which don't exist in `node_modules` (they're workspace packages).
3. The bundler may be incorrectly resolving a dependency, leading to a bare `'notification'` module reference.

### 4. Evidence from Codebase

**Notification-related imports found:**
- `apps/user-service/src/services/notification.service.ts` imports `@api-hub/logger`
- `apps/user-service/src/consumers/notification.consumer.ts` imports `@api-hub/logger`
- `apps/user-service/src/services/user.service.ts` imports `./notification.service`

**No direct `'notification'` import found**, suggesting the error comes from:
- Incorrect path resolution during bundling
- A transitive dependency resolution issue
- Runtime dynamic import that wasn't captured during bundling

---

## Solutions

### Solution 1: Configure serverless-esbuild for Workspace Dependencies (Recommended)

Update `serverless.yml` to properly handle workspace dependencies:

```yaml
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
    # Add resolver plugins for workspace dependencies
    plugins: plugins.js  # Create a plugins.js file (see below)
    # OR use resolveExtensions
    resolveExtensions:
      - '.ts'
      - '.js'
      - '.tsx'
      - '.jsx'
    # Ensure workspace dependencies are resolved
    alias:
      '@api-hub/logger': '../../libs/logger/src/index.ts'
      '@api-hub/utils': '../../libs/utils/src/index.ts'
      '@api-hub/fhir': '../../libs/fhir/src/index.ts'
      '@api-hub/error-messages': '../../libs/error-messages/src/index.ts'
```

**Alternative: Use esbuild-plugin-tsconfig-paths**

Create `apps/user-service/esbuild-plugins.js`:

```javascript
const { resolve } = require('path');
const { existsSync } = require('fs');

module.exports = [
  {
    name: 'nx-workspace-resolver',
    setup(build) {
      // Map workspace packages to their source files
      const workspacePackages = {
        '@api-hub/logger': resolve(__dirname, '../../libs/logger/src/index.ts'),
        '@api-hub/utils': resolve(__dirname, '../../libs/utils/src/index.ts'),
        '@api-hub/fhir': resolve(__dirname, '../../libs/fhir/src/index.ts'),
        '@api-hub/error-messages': resolve(__dirname, '../../libs/error-messages/src/index.ts'),
      };

      build.onResolve({ filter: /^@api-hub\/.*/ }, (args) => {
        const packagePath = workspacePackages[args.path];
        if (packagePath && existsSync(packagePath)) {
          return { path: packagePath };
        }
      });
    },
  },
];
```

Then update serverless.yml:
```yaml
custom:
  esbuild:
    bundle: true
    # ... other config
    plugins: esbuild-plugins.js
```

### Solution 2: Build Workspace Dependencies Before Deployment

Ensure workspace libraries are built before serverless packaging:

1. **Add to serverless.yml** (pre-deployment hook):
```yaml
plugins:
  - serverless-esbuild
  - serverless-dotenv-plugin
  - serverless-auto-swagger
  - serverless-offline
  - serverless-plugin-monorepo  # If available

custom:
  esbuild:
    # ... existing config
    # Point to built outputs instead of source
    alias:
      '@api-hub/logger': '../../libs/logger/dist/index.js'
      '@api-hub/utils': '../../libs/utils/dist/index.js'
      '@api-hub/fhir': '../../libs/fhir/dist/index.js'
      '@api-hub/error-messages': '../../libs/error-messages/dist/index.js'
```

2. **Create a deployment script** (`deploy.sh` or `deploy.js`):
```bash
#!/bin/bash
# Build workspace dependencies
nx run logger:build
nx run utils:build
nx run fhir:build
nx run error-messages:build

# Deploy serverless
cd apps/user-service
serverless deploy
```

### Solution 3: Use serverless-plugin-include-dependencies

This plugin helps include workspace dependencies:

```yaml
plugins:
  - serverless-esbuild
  - serverless-plugin-include-dependencies  # Add this

custom:
  esbuild:
    # ... existing config
  includeDependencies:
    - '@api-hub/logger'
    - '@api-hub/utils'
    - '@api-hub/fhir'
    - '@api-hub/error-messages'
```

### Solution 4: Package Configuration (Alternative Approach)

If bundling workspace dependencies proves difficult, package them explicitly:

```yaml
package:
  individually: true
  patterns:
    - '!node_modules/**'
    - 'node_modules/@api-hub/**'  # Include workspace packages

    - '../../libs/utils/dist/**' 
    - '../../libs/error-messages/dist/**'
    - '!**/*.test.ts'
    - '!**/*.spec.ts'
```

Then update `custom.esbuild`:
```yaml
custom:
  esbuild:
    bundle: false  # Change to false
    # ... rest of config
```

---

## Recommended Implementation Steps

### Step 1: Immediate Fix (Quick)
1. Create `apps/user-service/esbuild-plugins.js` with workspace resolver
2. Update `serverless.yml` to use the plugin
3. Test locally with `serverless offline`

### Step 2: Build Verification
1. Ensure all workspace libraries are built before deployment
2. Verify built outputs exist in `libs/*/dist/`
3. Check that paths in esbuild config match actual file locations

### Step 3: Deployment Process
1. Add pre-deployment build step to CI/CD
2. Update deployment scripts to build dependencies first
3. Add validation to ensure all workspace packages are built

### Step 4: Long-term Optimization
1. Consider using `serverless-plugin-monorepo` or similar
2. Evaluate if workspace dependencies should be pre-built and packaged
3. Consider publishing workspace packages to a private npm registry (if applicable)

---

## Debugging Steps

### 1. Check Bundled Output
```bash
cd apps/user-service
serverless package
# Check .serverless/<function-name>/handler.js for incorrect imports
```

### 2. Verify Workspace Resolution
```bash
# Check if paths resolve correctly
node -e "console.log(require.resolve('@api-hub/logger'))"
```

### 3. Test Bundling Locally
```bash
# Use esbuild directly to test
npx esbuild src/handlers/health.ts --bundle --platform=node --format=cjs --outfile=test-bundle.js
# Inspect test-bundle.js for import issues
```

### 4. Enable Detailed Logging
Add to `serverless.yml`:
```yaml
custom:
  esbuild:
    # ... existing config
    logLevel: verbose  # or debug
```

---

## Additional Considerations

### Node.js Module Resolution
AWS Lambda uses Node.js module resolution. When `bundle: true`, esbuild should inline all code, but workspace packages using TypeScript path mappings may not be resolved correctly.

### Conditional Exports
Workspace packages use conditional exports with `@api-hub/source`. Ensure esbuild respects these conditions or point directly to source files.

### TypeScript vs JavaScript
If pointing to `.ts` files in aliases, ensure esbuild can transpile them. Consider pointing to `.js` files from built outputs instead.

---

## Files to Modify

1. **`apps/user-service/serverless.yml`**
   - Update `custom.esbuild` section
   - Add plugin configuration or aliases

2. **`apps/user-service/esbuild-plugins.js`** (NEW)
   - Create workspace resolver plugin

3. **Deployment Scripts** (if needed)
   - Add pre-build steps for workspace dependencies

4. **CI/CD Pipeline** (if applicable)
   - Ensure workspace dependencies are built before serverless deployment

---

## Expected Outcome

After implementing the recommended solution:
- ✅ All workspace dependencies (`@api-hub/*`) are properly bundled or resolved
- ✅ No runtime module resolution errors
- ✅ Lambda functions execute successfully
- ✅ All imports resolve correctly at build time

---

## Testing Checklist

- [ ] Build workspace dependencies: `nx run-many -t build --projects=tag:scope:shared`
- [ ] Test bundling locally: `serverless package`
- [ ] Verify bundled output has no unresolved imports
- [ ] Test with `serverless offline`
- [ ] Deploy to dev stage and verify Lambda execution
- [ ] Check CloudWatch logs for module resolution errors

---

## References

- [serverless-esbuild documentation](https://github.com/floydspace/serverless-esbuild)
- [esbuild path resolution](https://esbuild.github.io/api/#resolve-extensions)
- [NX monorepo deployment best practices](https://nx.dev/recipes/deployment/deploying-monorepos)
- [TypeScript path mapping in esbuild](https://esbuild.github.io/api/#tsconfig)
