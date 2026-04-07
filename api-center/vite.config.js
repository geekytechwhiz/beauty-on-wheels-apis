import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
/**
 * NOTE: Vite resolves `vite.config.js` before `vite.config.ts`. Do not add a duplicate
 * `vite.config.js` — it will shadow this file and break proxy/env behavior.
 *
 * When `VITE_API_BASE_URL` is set (see `.env.development`), the app calls the API directly.
 * The `/api` proxy is only used when the app falls back to base `/api` (local Express aggregator).
 */
export default defineConfig({
    plugins: [react()],
    server: {
        port: 5173,
        proxy: {
            '/api': {
                target: 'http://localhost:4000',
                changeOrigin: true,
                rewrite: (path) => path.replace(/^\/api/, '') || '/',
            },
        },
    },
    optimizeDeps: {
        include: ['swagger-ui-react', 'swagger-ui'],
    },
});
