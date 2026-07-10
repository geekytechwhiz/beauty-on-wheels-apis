const fs = require('fs');
const path = require('path');

const ServerlessBuilder = require('./serverless/serverless-builder');
const ServerlessRenderer = require('./serverless/serverless-renderer');

const service = process.argv[2];

const metadata = JSON.parse(
  fs.readFileSync(`.codegen/${service}.json`, 'utf8'),
);

const builder = new ServerlessBuilder(metadata);

const model = builder.build();

const renderer = new ServerlessRenderer(model);

const projectRoot = path.join(process.cwd(), 'apps', `${service}-service`);

renderer.render(
  path.join(projectRoot, 'serverless.yml'),
);

console.log('✓ serverless.yml generated');

const esbuildPluginsPath = path.join(projectRoot, 'esbuild-plugins.js');
const esbuildPluginsContent = `// esbuild-plugin.js (CommonJS for serverless-esbuild require())
const { resolve } = require('node:path');
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
        '@api-hub/observability': resolve(
          workspaceRoot,
          'libs/observability/src/index.ts',
        ),
        '@api-hub/utils': resolve(workspaceRoot, 'libs/utils/src/index.ts'),
        '@api-hub/middleware': resolve(
          workspaceRoot,
          'libs/middleware/src/index.ts',
        ),
        '@api-hub/event-platform': resolve(
          workspaceRoot,
          'libs/event-platform/src/index.ts',
        ),
        '@api-hub/authentication-core': resolve(
          workspaceRoot,
          'libs/authentication-core/src/index.ts',
        ),
      };

      /**
       * Resolve @api-hub/* imports
       */
      build.onResolve({ filter: /^@api-hub\\/.*/ }, (args) => {
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
`;

fs.writeFileSync(esbuildPluginsPath, esbuildPluginsContent, 'utf8');
console.log('✓ esbuild-plugins.js generated');

const packageJsonPath = path.join(projectRoot, 'package.json');
if (fs.existsSync(packageJsonPath)) {
  try {
    const pkg = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
    pkg.devDependencies = pkg.devDependencies || {};
    pkg.devDependencies['serverless'] = '^3.40.0';
    pkg.devDependencies['serverless-esbuild'] = '^1.57.0';
    pkg.devDependencies['serverless-dotenv-plugin'] = '^6.0.0';
    pkg.devDependencies['serverless-auto-swagger'] = '^3.1.0';
    pkg.devDependencies['serverless-offline'] = '13.9.0';
    fs.writeFileSync(packageJsonPath, JSON.stringify(pkg, null, 2) + '\n', 'utf8');
    console.log('✓ package.json devDependencies updated');
  } catch (err) {
    console.error(`Warning: Failed to update package.json: ${err.message}`);
  }
}
