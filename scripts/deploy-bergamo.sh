#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

REMOTE_HOST="${DEPLOY_HOST:-bergamo}"
REMOTE_PATH="${DEPLOY_PATH:-/opt/fantafestando}"
PROFILE="${DEPLOY_PROFILE:-demo}"

SKIP_BUILD=false
SKIP_RSYNC=false
SKIP_HEALTH_CHECK=false
USE_CACHE=false

usage() {
    cat <<'EOF'
Usage: ./scripts/deploy-bergamo.sh [options]

Options:
  --host <ssh-host>          SSH host alias (default: bergamo)
  --path <remote-path>       Remote app path (default: /opt/fantafestando)
  --profile <compose-profile>Docker compose profile (default: demo)
  --skip-build               Skip local `npm run build`
  --skip-rsync               Skip rsync step
  --skip-health-check        Skip remote /api/health checks
  --use-cache                Build images with Docker cache (default: no-cache)
  -h, --help                 Show this help message
EOF
}

require_cmd() {
    local cmd="$1"
    if ! command -v "${cmd}" >/dev/null 2>&1; then
        echo "Missing required command: ${cmd}" >&2
        exit 1
    fi
}

while [[ $# -gt 0 ]]; do
    case "$1" in
        --host)
            REMOTE_HOST="${2:-}"
            shift 2
            ;;
        --path)
            REMOTE_PATH="${2:-}"
            shift 2
            ;;
        --profile)
            PROFILE="${2:-}"
            shift 2
            ;;
        --skip-build)
            SKIP_BUILD=true
            shift
            ;;
        --skip-rsync)
            SKIP_RSYNC=true
            shift
            ;;
        --skip-health-check)
            SKIP_HEALTH_CHECK=true
            shift
            ;;
        --use-cache)
            USE_CACHE=true
            shift
            ;;
        -h|--help)
            usage
            exit 0
            ;;
        *)
            echo "Unknown option: $1" >&2
            usage
            exit 1
            ;;
    esac
done

if [[ -z "${REMOTE_HOST}" || -z "${REMOTE_PATH}" || -z "${PROFILE}" ]]; then
    echo "Invalid empty option detected." >&2
    usage
    exit 1
fi

require_cmd git
require_cmd npm
require_cmd rsync
require_cmd ssh

cd "${ROOT_DIR}"

if ! git diff --quiet || ! git diff --cached --quiet; then
    echo "[deploy-bergamo] Warning: local working tree has uncommitted changes."
fi

BUILD_SHA="$(git rev-parse --short HEAD)"
VERSION=$(node -p "require('./package.json').version")
BUILD_DATE=$(date '+%Y-%m-%d %H:%M')

echo "[deploy-bergamo] Release version: ${VERSION}"
echo "[deploy-bergamo] Release build sha: ${BUILD_SHA}"
echo "[deploy-bergamo] Release build date: ${BUILD_DATE}"

if [[ "${SKIP_BUILD}" == "false" ]]; then
    echo "[deploy-bergamo] Running local production build..."
    npm run build
fi

if [[ "${SKIP_RSYNC}" == "false" ]]; then
    echo "[deploy-bergamo] Syncing project to ${REMOTE_HOST}:${REMOTE_PATH}..."
    rsync -rlz --delete \
      --exclude '.git' \
      --exclude '/node_modules' \
      --exclude '/public/uploads/' \
      --exclude '.next/cache' \
      --exclude '.next/dev' \
      --exclude 'playwright-report' \
      --exclude 'test-results' \
      --exclude '.env*' \
      ./ "${REMOTE_HOST}:${REMOTE_PATH}/"
fi

echo "[deploy-bergamo] Rebuilding and restarting remote stack..."
ssh "${REMOTE_HOST}" bash -s -- "${REMOTE_PATH}" "${BUILD_SHA}" "${PROFILE}" "${USE_CACHE}" "${VERSION}" "${BUILD_DATE}" <<'EOS'
set -euo pipefail

REMOTE_PATH="$1"
BUILD_SHA="$2"
PROFILE="$3"
USE_CACHE="$4"
VERSION="$5"
BUILD_DATE="$6"

cd "${REMOTE_PATH}"

if [[ ! -f .env.production ]]; then
    echo "Missing ${REMOTE_PATH}/.env.production" >&2
    exit 1
fi

mkdir -p public/uploads/menu-headers
chmod -R a+rwX public/uploads

if grep -q '^APP_BUILD=' .env.production; then
    sed -i -E "s/^APP_BUILD=.*/APP_BUILD=${BUILD_SHA}/" .env.production
else
    echo "APP_BUILD=${BUILD_SHA}" >> .env.production
fi

if grep -q '^APP_BUILD_DATE=' .env.production; then
    sed -i -E "s/^APP_BUILD_DATE=.*/APP_BUILD_DATE=\"${BUILD_DATE}\"/" .env.production
else
    echo "APP_BUILD_DATE=\"${BUILD_DATE}\"" >> .env.production
fi

# Ensure APP_VERSION matches package.json
if grep -q '^APP_VERSION=' .env.production; then
    sed -i -E "s/^APP_VERSION=.*/APP_VERSION=${VERSION}/" .env.production
else
    echo "APP_VERSION=${VERSION}" >> .env.production
fi

if [[ "${USE_CACHE}" == "true" ]]; then
    docker compose --env-file .env.production -f docker-compose.prod.yml build fantafestando-backoffice fantafestando-menu
else
    docker compose --env-file .env.production -f docker-compose.prod.yml build --no-cache fantafestando-backoffice fantafestando-menu
fi

docker compose --env-file .env.production -f docker-compose.prod.yml --profile "${PROFILE}" up -d --remove-orphans
docker compose --env-file .env.production -f docker-compose.prod.yml ps
EOS

if [[ "${SKIP_HEALTH_CHECK}" == "false" ]]; then
    echo "[deploy-bergamo] Running remote health checks..."
    ssh "${REMOTE_HOST}" 'curl -fsS http://127.0.0.1:3101/api/health && echo && curl -fsS http://127.0.0.1:3102/api/health'
fi

echo "[deploy-bergamo] Completed."
