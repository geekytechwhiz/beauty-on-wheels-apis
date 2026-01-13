const { resolve } = require('path');
const { existsSync } = require('fs');

/**
 * Esbuild plugin to resolve NX workspace dependencies (@api-hub/*)
 * This ensures workspace packages are properly resolved from source files during bundling
 */
module.exports = [
  {
    name: 'nx-workspace-resolver',
    setup(build) {
      const projectRoot = __dirname;
      const workspaceRoot = resolve(projectRoot, '../..');

      // Map workspace packages to their source files
      const workspacePackages = {
        '@api-hub/logger': resolve(workspaceRoot, 'libs/logger/src/index.ts'),
        '@api-hub/utils': resolve(workspaceRoot, 'libs/utils/src/index.ts'),
        '@api-hub/fhir': resolve(workspaceRoot, 'libs/fhir/src/index.ts'),
        '@api-hub/error-messages': resolve(workspaceRoot, 'libs/error-messages/src/index.ts'),
      };

      // Try built outputs first (for production), fallback to source
      const workspacePackagesBuilt = {
        '@api-hub/logger': resolve(workspaceRoot, 'libs/logger/dist/index.js'),
        '@api-hub/utils': resolve(workspaceRoot, 'libs/utils/dist/index.js'),
        '@api-hub/fhir': resolve(workspaceRoot, 'libs/fhir/dist/index.js'),
        '@api-hub/error-messages': resolve(workspaceRoot, 'libs/error-messages/dist/index.js'),
      };

      // Resolve workspace package imports
      build.onResolve({ filter: /^@api-hub\/.*/ }, (args) => {
        const packageName = args.path;
        const packagePath = workspacePackages[packageName];

        if (packagePath) {
          // Prefer built output if it exists, otherwise use source
          const builtPath = workspacePackagesBuilt[packageName];
          const resolvedPath = existsSync(builtPath) ? builtPath : packagePath;

          if (existsSync(resolvedPath)) {
            return { path: resolvedPath };
          }

          // If neither exists, log warning but return source path
          console.warn(
            `Warning: Workspace package ${packageName} not found at ${resolvedPath} or ${packagePath}`
          );
          return { path: packagePath };
        }

        // Let esbuild handle it normally if not a workspace package
        return undefined;
      });

      // Handle file extensions for TypeScript files
      build.onLoad({ filter: /.*/, namespace: 'file' }, (args) => {
        // This is handled by esbuild's default loader, but we can add custom logic here if needed
        return undefined;
      });
    },
  },
];
