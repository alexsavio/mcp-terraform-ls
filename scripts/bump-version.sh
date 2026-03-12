#!/usr/bin/env bash
# CalVer version bump script
# Format: YYYY.MM.MICRO (e.g., 2026.3.0, 2026.3.1)
#
# Usage:
#   ./scripts/bump-version.sh          # auto-increment micro within current month
#   ./scripts/bump-version.sh 5        # set micro to specific value

set -euo pipefail

PACKAGE_JSON="$(cd "$(dirname "$0")/.." && pwd)/package.json"

CURRENT_VERSION=$(node -p "require('$PACKAGE_JSON').version")
YEAR=$(date +%Y)
MONTH=$(date +%-m)  # no zero-padding

# Parse current version
IFS='.' read -r CUR_YEAR CUR_MONTH CUR_MICRO <<< "$CURRENT_VERSION"

if [ -n "${1:-}" ]; then
  # Explicit micro value
  MICRO="$1"
elif [ "$CUR_YEAR" = "$YEAR" ] && [ "$CUR_MONTH" = "$MONTH" ]; then
  # Same month — increment micro
  MICRO=$((CUR_MICRO + 1))
else
  # New month — reset micro
  MICRO=0
fi

NEW_VERSION="${YEAR}.${MONTH}.${MICRO}"

# Update package.json without npm version (avoids git tag side effects)
node -e "
const fs = require('fs');
const pkg = JSON.parse(fs.readFileSync('$PACKAGE_JSON', 'utf8'));
pkg.version = '$NEW_VERSION';
fs.writeFileSync('$PACKAGE_JSON', JSON.stringify(pkg, null, 2) + '\n');
"

echo "Version: ${CURRENT_VERSION} → ${NEW_VERSION}"
