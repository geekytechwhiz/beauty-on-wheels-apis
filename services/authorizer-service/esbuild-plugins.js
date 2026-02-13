const { resolve } = require('path');
const { existsSync } = require('fs');

/**
 * Esbuild plugin to resolve Nx workspace dependencies (@api-hub/*).
 */
module.exports = [
  {
    name: 'nx-workspace-resolver',
    setup(build) {
      const projectRoot = __dirname;
      const workspaceRoot = resolve(projectRoot, '../..');

      const workspacePackages = {
        '@api-hub/auth': resolve(workspaceRoot, 'libs/auth/src/index.ts'),
      };

      build.onResolve({ filter: /^@api-hub\/.*/ }, (args) => {
        const packageName = args.path;
        const packagePath = workspacePackages[packageName];

        if (packagePath) {
          if (existsSync(packagePath)) {
            return { path: packagePath };
          }
          console.error(`Error: Workspace package ${packageName} not found at ${packagePath}`);
          return undefined;
        }
        return undefined;
      });
    },
  },
];
