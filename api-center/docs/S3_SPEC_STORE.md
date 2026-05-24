# S3 spec store (dual-mode)

API Center can store OpenAPI specs in S3 when enabled. With the flag off, specs use the local filesystem (dev) or static assets (fallback).

## Environment flags

| Variable | Scope | Description |
|----------|-------|-------------|
| `VITE_ENABLE_S3_SPEC_STORE` | Frontend (build) | When `true`, upload/download spec bytes via S3 presigned URLs |
| `API_CENTER_USE_S3` | Vite dev server | When `true`, local spec API reads/writes S3 instead of `public/specs-store` |
| `S3_BUCKET` | Server / Lambda | Target bucket (default: `dev-mvx-developer-hub`) |
| `S3_APP_PREFIX` | Server / Lambda | Parent prefix inside bucket (default: `uploads`) |
| `SPECS_PREFIX` | Server / Lambda | Spec catalog prefix (default: `api-specs`; full S3 path: `uploads/api-specs`) |
| `AWS_REGION` | Server / Lambda | AWS region (default: `us-east-1`) |

## Local dev (S3 mode)

```bash
export API_CENTER_USE_S3=true
export S3_BUCKET=dev-mvx-developer-hub
export S3_APP_PREFIX=uploads
export SPECS_PREFIX=api-specs
export VITE_ENABLE_S3_SPEC_STORE=true
pnpm dev
```

## Production

Set `VITE_ENABLE_S3_SPEC_STORE=true` at build time when the deployed Lambda spec API should use presigned URLs for upload/download. The Lambda already requires `S3_BUCKET`, `S3_APP_PREFIX`, and `SPECS_PREFIX` (see `buildspec.yml`).

## S3 bucket CORS

When `VITE_ENABLE_S3_SPEC_STORE=true`, the browser PUTs and GETs objects directly against S3. Configure CORS on the bucket for your app origins:

```json
[
  {
    "AllowedHeaders": ["*"],
    "AllowedMethods": ["GET", "PUT", "HEAD"],
    "AllowedOrigins": [
      "http://localhost:5173",
      "https://your-cloudfront-domain.example.com"
    ],
    "ExposeHeaders": ["ETag"],
    "MaxAgeSeconds": 3600
  }
]
```

Replace `AllowedOrigins` with your dev server URL and production CloudFront (or custom domain) origin.

## Flow summary

- **Flag off:** `/upload` sends base64 to API; `/document` returns spec text; static `public/specs-store` fallback.
- **Flag on:** `/presigned-upload` → browser PUT to S3 → `/upload-complete`; `/presigned-download` → browser GET from S3. Catalog listing still uses `/catalog`.
