/// <reference types="vite/client" />
/// <reference types="node" />

interface ImportMetaEnv {
  readonly VITE_API_BASE_URL: string | undefined;
  /** In dev/preview, Vite exposes `GET/POST /__api-center/specs/*` (catalog lives at `/catalog`). Static files use `public/{VITE_SPECS_PREFIX}/`. */
  readonly VITE_ENABLE_LOCAL_SPEC_API: string | undefined;
  /** Default `specs-store` — must match `scripts/generate-spec-index.mjs` and deployed static path. */
  readonly VITE_SPECS_PREFIX: string | undefined;
  /** Default `specs-store/index.json` under `public/`. */
  readonly VITE_SPECS_INDEX_KEY: string | undefined;
  readonly VITE_STORYBOOK_URL: string | undefined;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
