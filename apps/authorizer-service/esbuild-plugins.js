// esbuild-plugin.js (CommonJS for serverless-esbuild require())
const { resolve } = require('node:path');
const { existsSync } = require('node:fs');

module.exports = [
  {
    name: 'nx-workspace-resolver',

    setup(build) {
      const projectRoot = __dirname;
      const workspaceRoot = resolve(projectRoot, '../..');

      const workspacePackages = {
        '@api-hub/observability': resolve(
          workspaceRoot,
          'libs/observability/src/index.ts',
        ),
        '@api-hub/utils': resolve(workspaceRoot, 'libs/utils/src/index.ts'),
        '@api-hub/authentication-core': resolve(
          workspaceRoot,
          'libs/authentication-core/src/index.ts',
        ),
      };

      build.onResolve({ filter: /^@api-hub\/.*/ }, (args) => {
        const packageName = args.path;
        const packagePath = workspacePackages[packageName];

        if (!packagePath) return;

        if (!existsSync(packagePath)) {
          return;
        }

        return {
          path: packagePath,
        };
      });
    },
  },
];
