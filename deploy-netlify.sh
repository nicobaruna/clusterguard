#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT_DIR"

SITE_ID="${NETLIFY_SITE_ID:-${1:-}}"
AUTH_TOKEN="${NETLIFY_AUTH_TOKEN:-${2:-}}"

if [[ -z "$SITE_ID" ]]; then
  echo "Usage: ./deploy-netlify.sh <netlify-site-id> [netlify-auth-token]"
  echo "Or set NETLIFY_SITE_ID and NETLIFY_AUTH_TOKEN environment variables first."
  exit 1
fi

if [[ -z "$AUTH_TOKEN" ]]; then
  echo "Netlify auth token not provided."
  echo "Set NETLIFY_AUTH_TOKEN or pass it as the second argument."
  exit 1
fi

echo "[1/3] Installing dependencies..."
npm install --no-audit --no-fund

echo "[2/3] Building site..."
npm run build

echo "[3/3] Deploying to Netlify..."
npx netlify deploy --prod --build --site "$SITE_ID" --auth "$AUTH_TOKEN" --message "Deploy from local script"

echo "Deploy completed."
