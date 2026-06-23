#!/bin/sh

if [ -s "$HOME/.nvm/nvm.sh" ]; then
  . "$HOME/.nvm/nvm.sh"
  nvm use >/dev/null 2>&1
fi

echo "🔍 Running lint-staged..."
npx lint-staged

LINT_RESULT=$?

if [ $LINT_RESULT -ne 0 ]; then
  echo "❌ Lint failed. Commit blocked."
  exit 1
fi

echo "🔍 Running ESLint on all modified files..."
node tools/lint-changed.js

if [ $? -ne 0 ]; then
  echo "❌ Lint failed. Commit blocked."
  exit 1
fi

echo "🛡️ Running MVRX Policy Validator on modified files..."
npx tsx tools/mvrx-policy-validator/src/index.ts --only-changed

POLICY_RESULT=$?

if [ $POLICY_RESULT -ne 0 ]; then
  echo "❌ Policy validation failed. Commit blocked."
  exit 1
fi

echo "✅ Pre-commit checks passed."