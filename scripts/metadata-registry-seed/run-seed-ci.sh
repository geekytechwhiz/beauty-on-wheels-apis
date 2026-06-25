#!/usr/bin/env bash
#
# CI/CD entrypoint for metadata registry seed (dev / stg / prd).
# Invoked from apps/metadata-registry-service/seed-*-buildspec.yml.
#
# Required when RUN_METADATA_SEED=true:
#   METADATA_CATALOG_S3_BUCKET, METADATA_CATALOG_S3_KEY, METADATA_EXCEL_PATH, BASE_URL
# Required when DRY_RUN=false (real seed):
#   AUTH_TOKEN or SEED_ACTOR_USER_ID — except dev allows neither (actor stored as system)
#
set -euo pipefail

log() {
  echo "[seed-ci] $*"
}

fail() {
  log "ERROR: $*"
  exit 1
}

is_true() {
  case "${1:-}" in
    true | TRUE | 1 | yes | YES) return 0 ;;
    *) return 1 ;;
  esac
}

REPO_ROOT="${CODEBUILD_SRC_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"
cd "$REPO_ROOT"

STAGE="${METADATA_SEED_STAGE:-${STAGE:-unknown}}"
DRY_RUN_RAW="${DRY_RUN:-true}"

if ! is_true "${RUN_METADATA_SEED:-}"; then
  log "RUN_METADATA_SEED is not true. Skipping metadata seed."
  exit 0
fi

if is_true "$DRY_RUN_RAW"; then
  DRY_RUN=true
else
  DRY_RUN=false
fi

# Excel catalog bucket: defaults to DEPLOYMENT_BUCKET (same S3 bucket as serverless deploy artifacts).
if [ -z "${METADATA_CATALOG_S3_BUCKET:-}" ] && [ -n "${DEPLOYMENT_BUCKET:-}" ]; then
  METADATA_CATALOG_S3_BUCKET="${DEPLOYMENT_BUCKET}"
  log "METADATA_CATALOG_S3_BUCKET not set — using DEPLOYMENT_BUCKET (${DEPLOYMENT_BUCKET})"
fi
if [ -z "${METADATA_CATALOG_S3_BUCKET:-}" ]; then
  fail "METADATA_CATALOG_S3_BUCKET or DEPLOYMENT_BUCKET is required when RUN_METADATA_SEED=true"
fi
if [ -z "${METADATA_CATALOG_S3_KEY:-}" ]; then
  fail "METADATA_CATALOG_S3_KEY is required when RUN_METADATA_SEED=true"
fi
if [ -z "${METADATA_EXCEL_PATH:-}" ]; then
  fail "METADATA_EXCEL_PATH is required when RUN_METADATA_SEED=true"
fi
if [ -z "${BASE_URL:-}" ]; then
  fail "BASE_URL is required when RUN_METADATA_SEED=true"
fi

if [ "$DRY_RUN" = false ] && [ -z "${AUTH_TOKEN:-}" ] && [ -z "${SEED_ACTOR_USER_ID:-}" ]; then
  if [ "$STAGE" = dev ]; then
    log "No AUTH_TOKEN or SEED_ACTOR_USER_ID — dev real seed allowed; createdBy/lastModifiedBy will be system"
  else
    fail "Real seed on ${STAGE} requires AUTH_TOKEN or SEED_ACTOR_USER_ID when DRY_RUN=false"
  fi
fi

SCOPED=false
if [ -n "${METADATA_TYPE_CODES:-}" ]; then
  SCOPED=true
fi

FULL_SEED=false
if [ "$SCOPED" = false ]; then
  FULL_SEED=true
fi

case "$STAGE" in
  stg | prd)
    if [ "$DRY_RUN" = false ] && ! is_true "${CONFIRM_METADATA_SEED:-}"; then
      fail "Real seed on ${STAGE} requires CONFIRM_METADATA_SEED=true (use a separate apply job after manual approval)"
    fi
    if [ "$FULL_SEED" = true ] && ! is_true "${ALLOW_FULL_METADATA_SEED:-}"; then
      fail "Full seed on ${STAGE} requires ALLOW_FULL_METADATA_SEED=true"
    fi
    ;;
esac

if [ "$FULL_SEED" = true ] && [ "$DRY_RUN" = false ]; then
  if ! is_true "${ALLOW_FULL_METADATA_SEED:-}"; then
    fail "Real full seed requires ALLOW_FULL_METADATA_SEED=true"
  fi
  if ! is_true "${CONFIRM_METADATA_SEED:-}"; then
    fail "Real full seed requires CONFIRM_METADATA_SEED=true"
  fi
fi

if [ -n "${AUTH_TOKEN:-}" ]; then
  SEED_AUTH_SOURCE="AUTH_TOKEN"
elif [ -n "${SEED_ACTOR_USER_ID:-}" ]; then
  SEED_AUTH_SOURCE="SEED_ACTOR_USER_ID"
else
  SEED_AUTH_SOURCE="system"
fi

log "========================================"
log "Metadata seed CI run"
log "  environment:     ${STAGE}"
log "  BASE_URL:        ${BASE_URL}"
log "  mode:            $([ "$DRY_RUN" = true ] && echo 'dry-run (no HTTP writes)' || echo 'real seed (HTTP draft/publish)')"
log "  scope:           $([ "$SCOPED" = true ] && echo "scoped (${METADATA_TYPE_CODES})" || echo 'full catalog')"
log "  S3 source:       s3://${METADATA_CATALOG_S3_BUCKET}/${METADATA_CATALOG_S3_KEY}"
if [ -n "${METADATA_CATALOG_S3_VERSION_ID:-}" ]; then
  log "  S3 version id:   ${METADATA_CATALOG_S3_VERSION_ID}"
fi
log "  local Excel:     ${METADATA_EXCEL_PATH}"
log "  seed auth:       Metadata seed auth source: ${SEED_AUTH_SOURCE}"
log "========================================"

log "Downloading catalog from S3..."
if [ -n "${METADATA_CATALOG_S3_VERSION_ID:-}" ]; then
  aws s3api get-object \
    --bucket "${METADATA_CATALOG_S3_BUCKET}" \
    --key "${METADATA_CATALOG_S3_KEY}" \
    --version-id "${METADATA_CATALOG_S3_VERSION_ID}" \
    "${METADATA_EXCEL_PATH}" >/dev/null
else
  aws s3 cp "s3://${METADATA_CATALOG_S3_BUCKET}/${METADATA_CATALOG_S3_KEY}" "${METADATA_EXCEL_PATH}"
fi

if [ ! -f "${METADATA_EXCEL_PATH}" ]; then
  fail "Downloaded Excel not found at ${METADATA_EXCEL_PATH}"
fi

EXCEL_BYTES="$(wc -c < "${METADATA_EXCEL_PATH}" | tr -d ' ')"
log "Excel downloaded (${EXCEL_BYTES} bytes)"

HEALTH_URL="${BASE_URL%/}/health"
log "Health check: ${HEALTH_URL}"
curl -sf "${HEALTH_URL}" >/dev/null || fail "Health check failed for ${HEALTH_URL}"

export METADATA_EXCEL_PATH
export DRY_RUN="$([ "$DRY_RUN" = true ] && echo true || echo false)"
export TREAT_CONFLICT_AS_SUCCESS="${TREAT_CONFLICT_AS_SUCCESS:-true}"
export CONFIRMATION_ACKNOWLEDGED="${CONFIRMATION_ACKNOWLEDGED:-true}"
# Actor env from seed-*-buildspec.yml env.variables (or CodeBuild project overrides)
if [ -n "${SEED_ACTOR_USER_ID:-}" ]; then
  export SEED_ACTOR_USER_ID
fi
if [ -n "${AUTH_TOKEN:-}" ]; then
  export AUTH_TOKEN
fi

mkdir -p scripts/metadata-registry-seed/reports

log "Running seed..."
if command -v pnpm >/dev/null 2>&1; then
  pnpm seed:metadata
else
  npx ts-node --project scripts/metadata-registry-seed/tsconfig.json scripts/metadata-registry-seed/seed-metadata.ts
fi

SEED_EXIT=$?

if [ -d scripts/metadata-registry-seed/reports ]; then
  log "Seed reports:"
  ls -la scripts/metadata-registry-seed/reports/ || true
fi

if [ "$SEED_EXIT" -ne 0 ]; then
  fail "pnpm seed:metadata exited with code ${SEED_EXIT}"
fi

log "Metadata seed CI completed successfully"
exit 0
