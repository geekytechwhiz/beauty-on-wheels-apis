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

      // Map workspace packages to their source files (preferred for bundling)
      const workspacePackages = {
        '@api-hub/observability': resolve(workspaceRoot, 'libs/observability/src/index.ts'),
        '@api-hub/utils': resolve(workspaceRoot, 'libs/utils/src/index.ts'),
        '@api-hub/service-clients': resolve(workspaceRoot, 'libs/service-clients/src/index.ts'),
        '@api-hub/middleware': resolve(workspaceRoot, 'libs/middleware/src/index.ts'),
        '@api-hub/fhir-validator': resolve(workspaceRoot, 'libs/fhir-validator/src/index.ts'),
        '@api-hub/event-platform': resolve(workspaceRoot, 'libs/event-platform/src/index.ts'),
      };

      // Resolve workspace package imports
      build.onResolve({ filter: /^@api-hub\/.*/ }, (args) => {
        const packageName = args.path;
        const packagePath = workspacePackages[packageName];

        if (packagePath) {
          if (existsSync(packagePath)) {
            return { path: packagePath };
          }

          // If source doesn't exist, log error
          console.error(
            `Error: Workspace package ${packageName} not found at ${packagePath}`
          );
          return undefined;
        }

        // Let esbuild handle it normally if not a workspace package
        return undefined;
      });
    },
  },
];
