import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { localSpecApiPlugin } from './vite-plugins/local-spec-api';
import { mergeSpecsStorePlugin } from './vite-plugins/merge-specs-store';
/**
 * NOTE: Vite resolves `vite.config.js` before `vite.config.ts`. Do not add a duplicate
 * `vite.config.js` — it will shadow this file and break proxy/env behavior.
 *
 * When `VITE_API_BASE_URL` is set (see `.env.development`), the app calls the API directly.
 * The `/api` proxy is only used when the app falls back to base `/api` (local Express aggregator).
 *
 * Local spec API is enabled for dev and preview by default.
 * Specs are stored on disk at `API_CENTER_SPECS_DIR` (defaults to `api-center/specs-store`).
 */
export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, process.cwd(), '');
    const localSpecApiEnabled = true;
    return {
        plugins: [
            react(),
            mergeSpecsStorePlugin({
                specsPrefix: env.VITE_SPECS_PREFIX,
            }),
            localSpecApiPlugin({
                enabled: localSpecApiEnabled,
                specsPrefix: env.VITE_SPECS_PREFIX,
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
