// CommonJS for serverless-esbuild
const { resolve } = require('node:path');
const { existsSync } = require('node:fs');

module.exports = [
  {
    name: 'nx-workspace-resolver',
    setup(build) {
      const workspaceRoot = resolve(__dirname, '../..');
      const workspacePackages = {
        '@api-hub/logger': resolve(workspaceRoot, 'libs/logger/src/index.ts'),
        '@api-hub/utils': resolve(workspaceRoot, 'libs/utils/src/index.ts'),
        '@api-hub/alert-repository': resolve(workspaceRoot, 'libs/alert-repository/src/index.ts'),
        '@api-hub/alert-integration': resolve(workspaceRoot, 'libs/alert-integration/src/index.ts'),
      };

      build.onResolve({ filter: /^@api-hub\/.*/ }, (args) => {
        const packagePath = workspacePackages[args.path];
        if (!packagePath || !existsSync(packagePath)) return;
        return { path: packagePath };
      });
    },
  },
];
