// esbuild-plugin.js (CommonJS for serverless-esbuild require())
const { resolve, dirname } = require('node:path');
const { existsSync } = require('node:fs');

/**
 * NX Workspace resolver plugin
 * Resolves @api-hub/* imports directly to source .ts files
 * so esbuild bundles them instead of treating as external deps
 */
module.exports = [
  {
    name: 'nx-workspace-resolver',

    setup(build) {
      const projectRoot = __dirname;
      const workspaceRoot = resolve(projectRoot, '../..');

      /**
       * Map workspace libs → source entry files
       * Add new libs here when you create them
       */
      const workspacePackages = {
        '@api-hub/observability': resolve(workspaceRoot, 'libs/observability/src/index.ts'),
        '@api-hub/utils': resolve(workspaceRoot, 'libs/utils/src/index.ts'),
        '@api-hub/fhir': resolve(workspaceRoot, 'libs/fhir/src/index.ts'),
        '@api-hub/middleware': resolve(workspaceRoot, 'libs/middleware/src/index.ts'),
        '@api-hub/observability': resolve(workspaceRoot, 'libs/observability/src/index.ts'),
        '@api-hub/event-platform': resolve(workspaceRoot, 'libs/event-platform/src/index.ts'),
        '@api-hub/service-clients': resolve(workspaceRoot, 'libs/service-clients/src/index.ts'),
      };

      /**
       * Resolve @api-hub/* imports
       */
      build.onResolve({ filter: /^@api-hub\/.*/ }, (args) => {
        const packageName = args.path;
        const packagePath = workspacePackages[packageName];

        if (!packagePath) return;

        if (!existsSync(packagePath)) {
          console.error(
            `[esbuild] Workspace package not found → ${packageName} (${packagePath})`
          );
          return;
        }

        return {
          path: packagePath,
        };
      });
    },
  },
];
