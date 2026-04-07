const { resolve } = require('path');
const { existsSync } = require('fs');

/**
 * (@api-hub/*) Resolve workspace packages to source for serverless-esbuild.
 */
module.exports = [
  {
    name: 'nx-workspace-resolver',
    setup(build) {
      const projectRoot = __dirname;
      const workspaceRoot = resolve(projectRoot, '../..');

      const workspacePackages = {
        '@api-hub/logger': resolve(workspaceRoot, 'libs/logger/src/index.ts'),
        '@api-hub/utils': resolve(workspaceRoot, 'libs/utils/src/index.ts'),
        '@api-hub/metadata': resolve(workspaceRoot, 'libs/metadata/src/index.ts'),
        '@api-hub/template': resolve(workspaceRoot, 'libs/template/src/index.ts'),
      };

      build.onResolve({ filter: /^@api-hub\/.*/ }, (args) => {
        const packagePath = workspacePackages[args.path];

        if (packagePath) {
          if (existsSync(packagePath)) {
            return { path: packagePath };
          }

          console.error(`Error: Workspace package ${args.path} not found at ${packagePath}`);
          return undefined;
        }

        return undefined;
      });
    },
  },
];
