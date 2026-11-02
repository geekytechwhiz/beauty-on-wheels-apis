#!/usr/bin/env bash
set -euo pipefail

DEPLOY=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --deploy)
      DEPLOY=true
      ;;
    -h|--help)
      echo "Usage: bash scripts/deploy-and-export-api-specs.sh [--deploy]"
      echo "Default: generate API specs only"
      echo "  --deploy: deploy all configured services before generating specs"
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      echo "Usage: bash scripts/deploy-and-export-api-specs.sh [--deploy]" >&2
      exit 2
      ;;
  esac
  shift
done

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [[ -n "${NX_WORKSPACE_ROOT:-}" ]]; then
  ROOT_DIR="$(cd "$NX_WORKSPACE_ROOT" && pwd)"
elif ROOT_DIR="$(git -C "$SCRIPT_DIR" rev-parse --show-toplevel 2>/dev/null)"; then
  :
elif [[ "$(basename "$SCRIPT_DIR")" == "scripts" ]]; then
  ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
else
  ROOT_DIR="$SCRIPT_DIR"
fi

CONFIG_FILE="${API_SPEC_CONFIG:-$ROOT_DIR/api-spec.config.json}"
SPEC_ROOT="${API_SPEC_DIR:-$ROOT_DIR/api-spec}"
DEPLOY_STAGE="${DEPLOY_STAGE:-dev}"
OPENAPI_VERSION="${OPENAPI_VERSION:-3.0.4}"

CURRENT_SERVICE="startup"
TEMP_DIR=""

fail() {
  printf 'ERROR: %s\n' "$*" >&2
  exit 1
}

cleanup() {
  if [[ -n "${TEMP_DIR:-}" && -d "$TEMP_DIR" ]]; then
    rm -rf "$TEMP_DIR"
  fi
}
trap cleanup EXIT

command -v jq >/dev/null 2>&1 || fail "jq is required"
[[ -f "$CONFIG_FILE" ]] || fail "Config file not found: $CONFIG_FILE"

jq -e '
  (.services | type == "array" and length > 0)
  and all(.services[];
    (.project | type == "string" and length > 0)
    and (.name | type == "string" and test("^[A-Za-z0-9][A-Za-z0-9._-]*$"))
  )
' "$CONFIG_FILE" >/dev/null || fail "Invalid services configuration in $CONFIG_FILE"

DUPLICATE_NAMES="$(jq -r '.services[].name' "$CONFIG_FILE" | sort | uniq -d)"
[[ -z "$DUPLICATE_NAMES" ]] || fail "Duplicate service names in config: $DUPLICATE_NAMES"

# Bash 3.2 compatible replacement for mapfile/readarray.
SERVICE_ROWS=()
while IFS= read -r ROW; do
  SERVICE_ROWS[${#SERVICE_ROWS[@]}]="$ROW"
done < <(jq -r '.services[] | [.project, .name] | @tsv' "$CONFIG_FILE")

[[ ${#SERVICE_ROWS[@]} -gt 0 ]] || fail "No services configured in $CONFIG_FILE"

mkdir -p "$SPEC_ROOT"

validate_project() {
  local project="$1"

  [[ "$project" == apps/* ]] || fail "Project must be under apps/: $project"
  [[ "$project" != *".."* ]] || fail "Project path cannot contain '..': $project"
  [[ -d "$ROOT_DIR/$project" ]] || fail "Project directory not found: $ROOT_DIR/$project"
}

resolve_serverless() {
  local project_dir="$1"
  local configured_bin

  if [[ -n "${SERVERLESS_BIN:-}" ]]; then
    if [[ "$SERVERLESS_BIN" == */* ]]; then
      if [[ "$SERVERLESS_BIN" == /* ]]; then
        configured_bin="$SERVERLESS_BIN"
      else
        configured_bin="$ROOT_DIR/$SERVERLESS_BIN"
      fi

      [[ -x "$configured_bin" ]] || fail "Serverless CLI is not executable: $configured_bin"
      printf '%s\n' "$configured_bin"
    else
      command -v "$SERVERLESS_BIN" || fail "Cannot find Serverless CLI: $SERVERLESS_BIN"
    fi
  elif [[ -x "$project_dir/node_modules/.bin/serverless" ]]; then
    printf '%s\n' "$project_dir/node_modules/.bin/serverless"
  elif [[ -x "$ROOT_DIR/node_modules/.bin/serverless" ]]; then
    printf '%s\n' "$ROOT_DIR/node_modules/.bin/serverless"
  else
    command -v serverless || fail "Serverless CLI not found. Install it in the workspace or set SERVERLESS_BIN."
  fi
}

# Deploy all configured services first, but only when --deploy is provided.
if [[ "$DEPLOY" == "true" ]]; then
  for ROW in "${SERVICE_ROWS[@]}"; do
    IFS=$'\t' read -r PROJECT SERVICE_NAME <<< "$ROW"
    CURRENT_SERVICE="$SERVICE_NAME"

    validate_project "$PROJECT"

    PROJECT_DIR="$ROOT_DIR/$PROJECT"
    SERVERLESS_BIN_PATH="$(resolve_serverless "$PROJECT_DIR")"

    printf '\n==> Deploying %s to stage %s\n' "$SERVICE_NAME" "$DEPLOY_STAGE"

    (
      cd "$PROJECT_DIR"
      "$SERVERLESS_BIN_PATH" deploy --force --stage "$DEPLOY_STAGE"
    )
  done
else
  printf 'Skipping deployment. Pass --deploy to deploy services first.\n'
fi

# Generate specs from each service's project root.
for ROW in "${SERVICE_ROWS[@]}"; do
  IFS=$'\t' read -r PROJECT SERVICE_NAME <<< "$ROW"
  CURRENT_SERVICE="$SERVICE_NAME"

  validate_project "$PROJECT"

  PROJECT_DIR="$ROOT_DIR/$PROJECT"
  SERVERLESS_BIN_PATH="$(resolve_serverless "$PROJECT_DIR")"
  SERVICE_SPEC_DIR="$SPEC_ROOT/$SERVICE_NAME"

  mkdir -p "$SERVICE_SPEC_DIR"
  TEMP_DIR="$(mktemp -d "$SERVICE_SPEC_DIR/.tmp.XXXXXX")"

  printf '\n==> Generating specs for %s\n' "$SERVICE_NAME"

  (
    cd "$PROJECT_DIR"
    "$SERVERLESS_BIN_PATH" openapi generate \
      -o "$TEMP_DIR/openapi.json" \
      -f json \
      -a "$OPENAPI_VERSION" \
      -p "$TEMP_DIR/postman.json"
  )

  [[ -s "$TEMP_DIR/openapi.json" ]] || fail "OpenAPI file was not created for $SERVICE_NAME"
  [[ -s "$TEMP_DIR/postman.json" ]] || fail "Postman file was not created for $SERVICE_NAME"

  jq --arg title "Carish $SERVICE_NAME API" \
    '.info.title = $title' \
    "$TEMP_DIR/openapi.json" > "$TEMP_DIR/openapi.named.json"

  jq --arg name "Carish $SERVICE_NAME API" \
    '.info.name = $name' \
    "$TEMP_DIR/postman.json" > "$TEMP_DIR/postman.named.json"

  mv "$TEMP_DIR/openapi.named.json" "$SERVICE_SPEC_DIR/openapi.json"
  mv "$TEMP_DIR/postman.named.json" "$SERVICE_SPEC_DIR/postman.json"

  rm -f "$TEMP_DIR/openapi.json" "$TEMP_DIR/postman.json"
  rmdir "$TEMP_DIR"
  TEMP_DIR=""

  printf 'Saved: %s/openapi.json\n' "$SERVICE_SPEC_DIR"
  printf 'Saved: %s/postman.json\n' "$SERVICE_SPEC_DIR"
done

trap - EXIT
printf '\nFinished. Specs are in %s\n' "$SPEC_ROOT"