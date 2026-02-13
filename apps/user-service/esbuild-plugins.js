const path = require('path');
const { existsSync } = require('fs');

/**
 * Esbuild plugin to resolve NX workspace dependencies (@api-hub/*).
 * Tries: 1) workspace source from __dirname, 2) workspace root from process.cwd(), 3) node_modules.
 */
function getWorkspaceRoots() {
  const roots = [];
  // From plugin location (apps/user-service -> repo root)
  roots.push(path.resolve(__dirname, '..', '..'));
  // From cwd (CodeBuild may run with different cwd)
  const cwd = process.cwd();
  if (cwd.endsWith('user-service')) {
    roots.push(path.resolve(cwd, '..', '..'));
  } else if (cwd.endsWith('api-hub') || cwd.includes('api-hub')) {
    roots.push(cwd);
  }
  return [...new Set(roots)];
}

function findPath(workspaceRoot, relativePath, packageName) {
  const sourcePath = path.resolve(workspaceRoot, relativePath);
  if (existsSync(sourcePath)) return sourcePath;
  // Fallback: node_modules (e.g. workspace link or published package)
  const pkgDir = path.resolve(workspaceRoot, 'node_modules', packageName);
  if (existsSync(pkgDir)) {
    try {
      const pkg = require(path.resolve(pkgDir, 'package.json'));
      const main = (pkg.exports && pkg.exports['.']) ? (pkg.exports['.'].import || pkg.exports['.'].default) : (pkg.module || pkg.main);
      if (main) {
        const entry = path.resolve(pkgDir, main);
        if (existsSync(entry)) return entry;
      }
      const srcEntry = path.resolve(pkgDir, 'src', 'index.ts');
      if (existsSync(srcEntry)) return srcEntry;
    } catch (_) {}
  }
  return null;
}

const WORKSPACE_PACKAGES = {
  '@api-hub/logger': 'libs/logger/src/index.ts',
  '@api-hub/utils': 'libs/utils/src/index.ts',
  '@api-hub/fhir': 'libs/fhir/src/index.ts',
  '@api-hub/error-messages': 'libs/error-messages/src/index.ts',
};

module.exports = [
  {
    name: 'nx-workspace-resolver',
    setup(build) {
      const workspaceRoots = getWorkspaceRoots();

      build.onResolve({ filter: /^@api-hub\/.*/ }, (args) => {
        const packageName = args.path;
        const relativePath = WORKSPACE_PACKAGES[packageName];
        if (!relativePath) return undefined;

        for (const root of workspaceRoots) {
          const resolved = findPath(root, relativePath, packageName);
          if (resolved) return { path: resolved };
        }

        const primaryPath = path.resolve(workspaceRoots[0], relativePath);
        console.error(`Error: Workspace package ${packageName} not found at ${primaryPath} (tried ${workspaceRoots.length} root(s) and node_modules).`);
        return undefined;
      });
    },
  },
];
