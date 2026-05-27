import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Plugin } from 'esbuild';
import { defineConfig } from 'tsup';

const PKG = '@myvitalrx/platform-tools';
const FHIR_MIDDLEWARE = `${PKG}/fhir/middleware`;
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '../..');

const sourceAliases = {
  '@api-hub/observability': path.join(root, 'libs/observability/src/index.ts'),
  '@api-hub/middleware': path.join(root, 'libs/middleware/src/index.ts'),
  '@api-hub/event-platform': path.join(root, 'libs/event-platform/src/index.ts'),
  '@api-hub/event-platform/dx': path.join(root, 'libs/event-platform/src/dx/index.ts'),
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
function externalPlatformImportsPlugin(): Plugin {
  const externals: Record<string, string> = {
    '@api-hub/observability': `${PKG}/observability`,
    '@api-hub/middleware': `${PKG}/middleware`,
    '@api-hub/fhir': `${PKG}/fhir`,
    '@api-hub/fhir/middleware': FHIR_MIDDLEWARE,
    '@myvitalrx/platform-tools/fhir/middleware': FHIR_MIDDLEWARE,
  };

  return {
    name: 'platform-import-externals',
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
    name: 'observability',
    entry: { observability: 'src/observability.ts' },
    format: ['esm', 'cjs'],
    dts: true,
    sourcemap: true,
    treeshake: true,
    target: 'node18',
    outDir: 'dist',
    clean: true,
    tsconfig: 'tsconfig.build.json',
    external: awsExternal,
    esbuildOptions(options) {
      options.alias = {
        ...options.alias,
        '@api-hub/observability': sourceAliases['@api-hub/observability'],
      };
    },
    outExtension({ format }) {
      return { js: format === 'esm' ? '.js' : '.cjs' };
    },
  },
  {
    name: 'fhir',
    entry: { fhir: sourceAliases['@api-hub/fhir'] },
    format: ['esm'],
    dts: false,
    sourcemap: true,
    treeshake: true,
    target: 'node18',
    outDir: 'dist',
    clean: false,
    tsconfig: 'tsconfig.build.json',
    external: [...awsExternal, `${PKG}/observability`],
    esbuildPlugins: [externalPlatformImportsPlugin()],
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
    entry: { 'fhir/middleware': sourceAliases['@api-hub/fhir/middleware'] },
    format: ['esm'],
    dts: true,
    sourcemap: true,
    treeshake: true,
    target: 'node18',
    outDir: 'dist',
    clean: false,
    tsconfig: 'tsconfig.build.json',
    external: [...awsExternal, `${PKG}/observability`, `${PKG}/fhir`],
    esbuildPlugins: [externalPlatformImportsPlugin()],
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
  {
    name: 'middleware',
    entry: { middleware: sourceAliases['@api-hub/middleware'] },
    format: ['esm'],
    dts: true,
    sourcemap: true,
    treeshake: true,
    target: 'node18',
    outDir: 'dist',
    clean: false,
    tsconfig: 'tsconfig.build.json',
    external: [...awsExternal, `${PKG}/observability`, FHIR_MIDDLEWARE],
    esbuildPlugins: [externalPlatformImportsPlugin()],
    esbuildOptions(options) {
      options.alias = {
        ...options.alias,
        '@api-hub/middleware': sourceAliases['@api-hub/middleware'],
      };
    },
  },
  {
    name: 'event-platform-dx',
    entry: { 'event-platform-dx': sourceAliases['@api-hub/event-platform/dx'] },
    format: ['esm'],
    dts: true,
    sourcemap: false,
    treeshake: true,
    target: 'node18',
    outDir: 'dist',
    clean: false,
    tsconfig: 'tsconfig.build.json',
    external: [...awsExternal, `${PKG}/event-platform`, `${PKG}/middleware`, `${PKG}/observability`],
    esbuildPlugins: [externalPlatformImportsPlugin()],
    esbuildOptions(options) {
      options.alias = {
        ...options.alias,
        '@api-hub/event-platform/dx': sourceAliases['@api-hub/event-platform/dx'],
      };
    },
  },
  {
    name: 'event-platform',
    entry: {
      'event-platform': sourceAliases['@api-hub/event-platform'],
    },
    format: ['esm'],
    dts: false,
    sourcemap: true,
    treeshake: true,
    target: 'node18',
    outDir: 'dist',
    clean: false,
    tsconfig: 'tsconfig.build.json',
    external: [
      ...awsExternal,
      `${PKG}/middleware`,
      `${PKG}/observability`,
    ],
    esbuildPlugins: [externalPlatformImportsPlugin()],
    esbuildOptions(options) {
      options.alias = {
        ...options.alias,
        '@api-hub/event-platform': sourceAliases['@api-hub/event-platform'],
        '@api-hub/event-platform/dx': sourceAliases['@api-hub/event-platform/dx'],
      };
    },
  },
]);
