const { resolve } = require('path');
const { existsSync } = require('fs');

/**
 * Resolves @api-hub/* to workspace source so serverless-esbuild bundles them.
 */
module.exports = [
  {
    name: 'nx-workspace-resolver',
    setup(build) {
      const projectRoot = __dirname;
      const workspaceRoot = resolve(projectRoot, '../..');

      const templateCore = resolve(workspaceRoot, 'libs/template-core/src/index.ts');
      const templateStorage = resolve(workspaceRoot, 'libs/template-storage/src/index.ts');
      const workspacePackages = {
        '@api-hub/logger': resolve(workspaceRoot, 'libs/logger/src/index.ts'),
        '@api-hub/utils': resolve(workspaceRoot, 'libs/utils/src/index.ts'),
        '@api-hub/template-core': templateCore,
        '@api-hub/template-storage': templateStorage,
        '@api-hub/template-dto': templateCore,
        '@api-hub/template-rules': templateCore,
        '@api-hub/template-executor': templateCore,
        '@api-hub/template-repository': templateCore,
      };

      build.onResolve({ filter: /^@api-hub\/.*/ }, (args) => {
        const packagePath = workspacePackages[args.path];
        if (!packagePath) return undefined;
        if (!existsSync(packagePath)) {
          console.error(`[esbuild] Workspace package not found → ${args.path} (${packagePath})`);
          return undefined;
        }
        return { path: packagePath };
      });
    },
  },
];
