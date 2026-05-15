#!/bin/bash

set -e

echo "Generating template-core library structure..."

############################################################
# CONFIG
############################################################

LIB_NAME="template-core"
BASE="libs/$LIB_NAME/src"

############################################################
# HELPERS
############################################################

create_file() {
  FILE=$1

  if [ ! -f "$FILE" ]; then
    mkdir -p "$(dirname "$FILE")"
    touch "$FILE"
    echo "Created: $FILE"
  fi
}

ensure_dir() {
  DIR=$1
  mkdir -p "$DIR"
}

############################################################
# ROOT SRC DIRECTORIES
############################################################

mkdir -p "$BASE"/{services,repositories,validators,mappers,events,constants,enums,types,utils}

mkdir -p "$BASE/models"/{entities,dto,requests,responses,events,value-objects}

############################################################
# SERVICES
############################################################

SERVICES=(
  "template.service.ts"
  "template-publish.service.ts"
  "template-version.service.ts"
  "org-template.service.ts"
  "template-diff.service.ts"
  "template-upgrade.service.ts"
  "metadata-allocation.service.ts"
  "compatibility.service.ts"
)

for f in "${SERVICES[@]}"; do
  create_file "$BASE/services/$f"
done

############################################################
# REPOSITORIES
############################################################

REPOS=(
  "template.repository.ts"
  "org-template.repository.ts"
  "template-version.repository.ts"
  "audit.repository.ts"
)

for f in "${REPOS[@]}"; do
  create_file "$BASE/repositories/$f"
done

############################################################
# VALIDATORS
############################################################

VALIDATORS=(
  "template.validator.ts"
  "metadata.validator.ts"
  "compatibility.validator.ts"
  "publish.validator.ts"
)

for f in "${VALIDATORS[@]}"; do
  create_file "$BASE/validators/$f"
done

############################################################
# EMPTY / PLACEHOLDER DIRECTORIES (tracked via .gitkeep)
############################################################

for dir in \
  "$BASE/mappers" \
  "$BASE/events" \
  "$BASE/constants" \
  "$BASE/enums" \
  "$BASE/types" \
  "$BASE/utils" \
  "$BASE/models/entities" \
  "$BASE/models/dto" \
  "$BASE/models/requests" \
  "$BASE/models/responses" \
  "$BASE/models/events" \
  "$BASE/models/value-objects"
do
  ensure_dir "$dir"
  GITKEEP="$dir/.gitkeep"
  if [ ! -f "$GITKEEP" ]; then
    touch "$GITKEEP"
    echo "Created: $GITKEEP"
  fi
done

############################################################
# BARREL EXPORT (src/index.ts)
############################################################

INDEX="$BASE/index.ts"
if [ ! -f "$INDEX" ]; then
  mkdir -p "$(dirname "$INDEX")"
  cat > "$INDEX" << 'EOF'
/**
 * @api-hub/template-core — template domain services, repositories, and models.
 * Populate barrel exports as implementations land.
 */

export {};
EOF
  echo "Created: $INDEX"
fi

############################################################
# README (library root)
############################################################

README="libs/$LIB_NAME/README.md"
if [ ! -f "$README" ]; then
  mkdir -p "$(dirname "$README")"
  cat > "$README" << EOF
# template-core

Generated scaffolding for template lifecycle (publish, versions, org templates, metadata allocation, compatibility).

Regenerate folder layout by running scripts/template-lib.sh from the repo root.
EOF
  echo "Created: $README"
fi

############################################################
# DONE
############################################################

echo ""
echo "✅ template-core structure generated successfully!"
echo ""
echo "Library:"
echo "libs/$LIB_NAME"
echo ""
