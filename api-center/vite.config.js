import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { localSpecApiPlugin } from './vite-plugins/local-spec-api';
import { mergeSpecsStorePlugin } from './vite-plugins/merge-specs-store';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
function publicBaseFromEnv(raw) {
    if (!raw?.trim())
        return '/';
    let b = raw.trim();
    if (!b.startsWith('/'))
        b = `/${b}`;
    if (!b.endsWith('/'))
        b = `${b}/`;
    return b;
}
/**
 * When `VITE_PUBLIC_BASE_PATH` is set (e.g. `/developer-hub/`), Vite emits asset URLs under
 * that prefix so deploys behind a subpath do not request `/assets/*` at the domain root.
 *
 * When `VITE_API_BASE_URL` is set (see `.env.development`), the app calls the API directly.
 * The `/api` proxy is only used when the app falls back to base `/api` (local Express aggregator).
 *
 * Local spec API is enabled for dev and preview by default.
 * Specs are stored on disk at `API_CENTER_SPECS_DIR` (defaults to `api-center/specs-store`).
 * Set `API_CENTER_USE_S3=true` with `S3_BUCKET=dev-mvx-developer-hub`, `S3_APP_PREFIX=uploads`,
 * and `SPECS_PREFIX=api-specs` (full S3 path: `uploads/api-specs`) to use S3 in local dev.
 * Pair with `VITE_ENABLE_S3_SPEC_STORE=true` for presigned URL transfer.
 */
export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, __dirname, '');
    const localSpecApiEnabled = true;
    const useS3 = env.API_CENTER_USE_S3 === 'true';
    return {
        root: __dirname,
        base: publicBaseFromEnv(env.VITE_PUBLIC_BASE_PATH),
        plugins: [
            react(),
            mergeSpecsStorePlugin({
                specsPrefix: env.VITE_SPECS_PREFIX,
            }),
            localSpecApiPlugin({
                enabled: localSpecApiEnabled,
                specsPrefix: env.VITE_SPECS_PREFIX,
                useS3,
            }),
        ],
        server: {
            port: 5173,
            proxy: {
                '^/api(?:/|$)': {
                    target: 'http://localhost:4000',
                    changeOrigin: true,
                    rewrite: (path) => path.replace(/^\/api/, '') || '/',
                },
            },
        },
        optimizeDeps: {
            include: ['swagger-ui-react', 'swagger-ui'],
        },
    };
});
