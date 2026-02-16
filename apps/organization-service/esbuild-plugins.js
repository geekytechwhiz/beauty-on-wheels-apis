const { resolve } = require('path');
const { existsSync } = require('fs');

/**
 *  (@api-hub/*)
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
        '@api-hub/logger': resolve(workspaceRoot, 'libs/logger/src/index.ts'),
        '@api-hub/utils': resolve(workspaceRoot, 'libs/utils/src/index.ts'),
        '@api-hub/fhir': resolve(workspaceRoot, 'libs/fhir/src/index.ts'),
        '@api-hub/error-messages': resolve(workspaceRoot, 'libs/error-messages/src/index.ts'),
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
