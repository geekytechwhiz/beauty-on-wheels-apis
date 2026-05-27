/// <reference types="vite/client" />
/// <reference types="node" />

interface ImportMetaEnv {
  /** Public URL prefix for the built app (e.g. `/hub/`). Must start/end with `/` when set; see `vite.config.ts`. */
  readonly VITE_PUBLIC_BASE_PATH: string | undefined;
  readonly VITE_API_BASE_URL: string | undefined;
  /** In dev/preview, Vite exposes `GET/POST /__api-center/specs-store/*` (catalog lives at `/catalog`). Static files use `public/{VITE_SPECS_PREFIX}/`. */
  readonly VITE_ENABLE_LOCAL_SPEC_API: string | undefined;
  /** Deployed spec write API (Lambda Function URL). Required for uploads in production. */
  readonly VITE_SPEC_API_BASE_URL: string | undefined;
  /** Default `specs-store` — must match `scripts/generate-spec-index.mjs` and deployed static path. */
  readonly VITE_SPECS_PREFIX: string | undefined;
  /** Default `specs-store/index.json` under `public/`. */
  readonly VITE_SPECS_INDEX_KEY: string | undefined;
  /** When `true`, upload/download spec bytes via S3 presigned URLs instead of proxying through the API. */
  readonly VITE_ENABLE_S3_SPEC_STORE: string | undefined;
  /** Yes3 file API base (upload/download/list presigned URLs). */
  readonly VITE_YES3_API_BASE_URL: string | undefined;
  /** S3 app prefix for Yes3 keys (default `uploads`). */
  readonly VITE_S3_APP_PREFIX: string | undefined;
  /** Catalog prefix inside the bucket for OpenAPI specs (default `api-specs`). */
  readonly VITE_YES3_SPECS_PREFIX: string | undefined;
  readonly VITE_STORYBOOK_URL: string | undefined;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
