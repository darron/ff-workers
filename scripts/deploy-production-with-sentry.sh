#!/usr/bin/env bash
set -euo pipefail

ENVIRONMENT="${1:-production}"
SENTRY_CLI=(npx --yes @sentry/cli)
WRANGLER_CLI=(npx --yes wrangler)

require_env() {
  local name="$1"
  if [[ -z "${!name:-}" ]]; then
    echo "Missing required environment variable: ${name}" >&2
    exit 1
  fi
}

require_env "SENTRY_AUTH_TOKEN"
require_env "SENTRY_ORG"
require_env "SENTRY_PROJECT"

echo "Proposing Sentry release version..."
VERSION="${SENTRY_RELEASE:-$("${SENTRY_CLI[@]}" releases propose-version)}"
echo "Using Sentry release: ${VERSION}"

echo "Creating Sentry release..."
"${SENTRY_CLI[@]}" releases new "${VERSION}"

echo "Associating commits..."
"${SENTRY_CLI[@]}" releases set-commits "${VERSION}" --auto

echo "Deploying worker to ${ENVIRONMENT}..."
"${WRANGLER_CLI[@]}" deploy --env "${ENVIRONMENT}" \
  --var "SENTRY_RELEASE:${VERSION}" \
  --var "SENTRY_ENVIRONMENT:${ENVIRONMENT}"

echo "Finalizing Sentry release..."
"${SENTRY_CLI[@]}" releases finalize "${VERSION}"

echo "Recording Sentry deploy..."
"${SENTRY_CLI[@]}" releases deploys "${VERSION}" new -e "${ENVIRONMENT}"

echo "Done. Deployed ${ENVIRONMENT} with Sentry release ${VERSION}."
