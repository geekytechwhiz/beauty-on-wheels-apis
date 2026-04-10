/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_BASE_URL: string | undefined;
  readonly VITE_AWS_REGION: string | undefined;
  readonly VITE_AWS_ACCESS_KEY_ID: string | undefined;
  readonly VITE_AWS_SECRET_ACCESS_KEY: string | undefined;
  readonly VITE_S3_BUCKET_NAME: string | undefined;
  readonly VITE_S3_SPECS_PREFIX: string | undefined;
  readonly VITE_STORYBOOK_URL: string | undefined;
  readonly VITE_S3_FIGMA_DESIGNS_KEY: string | undefined;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
