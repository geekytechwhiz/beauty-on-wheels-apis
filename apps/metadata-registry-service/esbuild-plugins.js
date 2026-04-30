const { resolve } = require('path');
const { existsSync } = require('fs');

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
