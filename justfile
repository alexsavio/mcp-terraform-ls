# List available recipes
default:
    @just --list

# Install dependencies
install:
    npm ci

# Build the project
build:
    npm run build

# Build in watch mode
dev:
    npm run dev

# Run tests
test:
    npm run test

# Run linter
lint:
    npm run lint

# Fix lint errors
lint-fix:
    npm run lint:fix

# Check formatting
format-check:
    npm run format:check

# Format source files
format:
    npm run format

# Run all checks (format, lint, build, test)
check:
    npm run check

# Bump version (CalVer YYYY.MM.MICRO)
version-bump:
    bash scripts/bump-version.sh

# Create a release tag and push it
release: check
    #!/usr/bin/env bash
    set -euo pipefail
    version=$(node -p "require('./package.json').version")
    git add package.json
    git commit -m "chore: bump version to ${version}" || true
    git tag "v${version}"
    git push origin main --tags
    echo "Tagged and pushed v${version}"

# Clean build artifacts
clean:
    rm -rf dist
