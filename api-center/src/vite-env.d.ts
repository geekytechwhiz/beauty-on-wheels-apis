/// <reference types="vite/client" />
/// <reference types="node" />

interface ImportMetaEnv {
  readonly VITE_API_BASE_URL: string | undefined;
  /** When `true` in dev, Vite exposes `POST /__api-center/specs/*` to write into `public/specs/`. */
  readonly VITE_ENABLE_LOCAL_SPEC_API: string | undefined;
  /** Default `specs` — must match `scripts/generate-spec-index.mjs` and deployed static path. */
  readonly VITE_SPECS_PREFIX: string | undefined;
  /** Default `specs/index.json` under `public/`. */
  readonly VITE_SPECS_INDEX_KEY: string | undefined;
  readonly VITE_STORYBOOK_URL: string | undefined;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
