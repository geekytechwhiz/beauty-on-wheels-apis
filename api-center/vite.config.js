import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { localSpecApiPlugin } from './vite-plugins/local-spec-api';
/**
 * NOTE: Vite resolves `vite.config.js` before `vite.config.ts`. Do not add a duplicate
 * `vite.config.js` — it will shadow this file and break proxy/env behavior.
 *
 * When `VITE_API_BASE_URL` is set (see `.env.development`), the app calls the API directly.
 * The `/api` proxy is only used when the app falls back to base `/api` (local Express aggregator).
 *
 * Set `VITE_ENABLE_LOCAL_SPEC_API=true` in `.env.development` to allow the dev server to
 * write uploaded specs into `public/specs/` (see `vite-plugins/local-spec-api.ts`).
 */
export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, process.cwd(), '');
    const localSpecApiEnabled = env.VITE_ENABLE_LOCAL_SPEC_API === 'true';
    return {
        plugins: [
            react(),
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
