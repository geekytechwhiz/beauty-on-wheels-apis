import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Plugin } from 'esbuild';
import { defineConfig } from 'tsup';

const PKG = '@myvitalrx/fhir-wrapper';
const FHIR_MIDDLEWARE = `${PKG}/middleware`;
const OBSERVABILITY = '@myvitalrx/platform-tools/observability';
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '../..');

const sourceAliases = {
  '@api-hub/observability': path.join(root, 'libs/observability/src/index.ts'),
  '@api-hub/utils': path.join(root, 'libs/utils/src/index.ts'),
  '@api-hub/fhir': path.join(root, 'libs/fhir/src/index.ts'),
  '@api-hub/fhir/middleware': path.join(root, 'libs/fhir/src/middleware/index.ts'),
  '@api-hub/terminology': path.join(root, 'libs/terminology/src/index.ts'),
} as const;

const awsExternal = [
  /^@aws-sdk\//,
  /^@smithy\//,
  '@aws-lambda-powertools/logger',
  '@aws-lambda-powertools/metrics',
  '@aws-lambda-powertools/tracer',
  '@aws-lambda-powertools/commons',
  'aws-lambda',
  'zod',
  'tslib',
];

/** Rewrite workspace imports to published package subpaths. */
function externalFhirWrapperImportsPlugin(): Plugin {
  const externals: Record<string, string> = {
    '@api-hub/observability': OBSERVABILITY,
    '@api-hub/fhir': PKG,
    '@api-hub/fhir/middleware': FHIR_MIDDLEWARE,
    [`${PKG}/middleware`]: FHIR_MIDDLEWARE,
  };

  return {
    name: 'fhir-wrapper-import-externals',
    setup(build) {
      for (const [from, to] of Object.entries(externals)) {
        build.onResolve({ filter: new RegExp(`^${from.replace('/', '\\/')}$`) }, () => ({
          path: to,
          external: true,
        }));
      }
    },
  };
}

export default defineConfig([
  {
    name: 'fhir-main',
    entry: { index: sourceAliases['@api-hub/fhir'] },
    format: ['esm'],
    dts: true,
    sourcemap: true,
    treeshake: true,
    target: 'node18',
    outDir: 'dist',
    clean: true,
    tsconfig: 'tsconfig.build.json',
    external: [...awsExternal, OBSERVABILITY],
    esbuildPlugins: [externalFhirWrapperImportsPlugin()],
    esbuildOptions(options) {
      options.alias = {
        ...options.alias,
        '@api-hub/fhir': sourceAliases['@api-hub/fhir'],
        '@api-hub/terminology': sourceAliases['@api-hub/terminology'],
        '@api-hub/observability': sourceAliases['@api-hub/observability'],
        '@api-hub/utils': sourceAliases['@api-hub/utils'],
      };
    },
  },
  {
    name: 'fhir-middleware',
    entry: { middleware: sourceAliases['@api-hub/fhir/middleware'] },
    format: ['esm'],
    dts: true,
    sourcemap: true,
    treeshake: true,
    target: 'node18',
    outDir: 'dist',
    clean: false,
    tsconfig: 'tsconfig.build.json',
    external: [...awsExternal, OBSERVABILITY, PKG],
    esbuildPlugins: [externalFhirWrapperImportsPlugin()],
    esbuildOptions(options) {
      options.alias = {
        ...options.alias,
        '@api-hub/fhir/middleware': sourceAliases['@api-hub/fhir/middleware'],
        '@api-hub/terminology': sourceAliases['@api-hub/terminology'],
        '@api-hub/observability': sourceAliases['@api-hub/observability'],
        '@api-hub/utils': sourceAliases['@api-hub/utils'],
      };
    },
  },
]);
