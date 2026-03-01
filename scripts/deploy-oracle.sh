#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REMOTE_HOST="${DEPLOY_HOST:-}"
REMOTE_USER="${DEPLOY_USER:-ubuntu}"
REMOTE_PATH="${DEPLOY_PATH:-/opt/osgfest}"
PROFILE="${DEPLOY_PROFILE:-demo}"
SSH_KEY="${DEPLOY_SSH_KEY:-}"
BOOTSTRAP=true
SKIP_BUILD=true
SKIP_RSYNC=false
SKIP_HEALTH_CHECK=false
USE_CACHE=false

usage() {
  cat <<'USAGE'
Usage: ./scripts/deploy-oracle.sh --host <ip-or-alias> [options]

Options:
  --host <ip-or-alias>       Oracle VM host/IP (required)
  --user <ssh-user>          SSH user (default: ubuntu)
  --key <path>               SSH private key path
  --path <remote-path>       Remote app path (default: /opt/osgfest)
  --profile <profile>        Docker compose profile (default: demo)
  --no-bootstrap             Skip remote bootstrap (docker/caddy/nginx)
  --local-build              Run local npm run build before deploy
  --skip-build               Skip local build (backward-compatible alias)
  --skip-rsync               Skip rsync step
  --skip-health-check        Skip remote /api/health checks
  --use-cache                Use Docker cache on remote build
  -h, --help                 Show this help
USAGE
}

require_cmd() {
  local cmd="$1"
  if ! command -v "$cmd" >/dev/null 2>&1; then
    echo "Missing required command: $cmd" >&2
    exit 1
  fi
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --host) REMOTE_HOST="${2:-}"; shift 2 ;;
    --user) REMOTE_USER="${2:-}"; shift 2 ;;
    --key) SSH_KEY="${2:-}"; shift 2 ;;
    --path) REMOTE_PATH="${2:-}"; shift 2 ;;
    --profile) PROFILE="${2:-}"; shift 2 ;;
    --no-bootstrap) BOOTSTRAP=false; shift ;;
    --local-build) SKIP_BUILD=false; shift ;;
    --skip-build) SKIP_BUILD=true; shift ;;
    --skip-rsync) SKIP_RSYNC=true; shift ;;
    --skip-health-check) SKIP_HEALTH_CHECK=true; shift ;;
    --use-cache) USE_CACHE=true; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown option: $1" >&2; usage; exit 1 ;;
  esac
done

if [[ -z "${REMOTE_HOST}" ]]; then
  echo "--host is required" >&2
  usage
  exit 1
fi

require_cmd git
require_cmd npm
require_cmd rsync
require_cmd ssh

cd "${ROOT_DIR}"

if [[ ! -f .env.production ]]; then
  echo "Missing ${ROOT_DIR}/.env.production. Create from .env.production.example first." >&2
  exit 1
fi

if ! git diff --quiet || ! git diff --cached --quiet; then
  echo "[deploy-oracle] Warning: local working tree has uncommitted changes."
fi

BUILD_SHA="$(git rev-parse --short HEAD)"
VERSION="$(node -p "require('./package.json').version")"
BUILD_DATE="$(date '+%Y-%m-%d %H:%M')"

echo "[deploy-oracle] Host: ${REMOTE_USER}@${REMOTE_HOST}"
echo "[deploy-oracle] Path: ${REMOTE_PATH}"
echo "[deploy-oracle] Profile: ${PROFILE}"
echo "[deploy-oracle] Version: ${VERSION}"
echo "[deploy-oracle] Build SHA: ${BUILD_SHA}"

SSH_OPTS=(-o StrictHostKeyChecking=accept-new)
if [[ -n "${SSH_KEY}" ]]; then
  SSH_OPTS+=(-i "${SSH_KEY}")
fi

SSH_TARGET="${REMOTE_USER}@${REMOTE_HOST}"

if [[ "${SKIP_BUILD}" == "false" ]]; then
  echo "[deploy-oracle] Running local production build..."
  npm run build
else
  echo "[deploy-oracle] Skipping local build (remote Docker build will compile the app)."
fi

if [[ "${BOOTSTRAP}" == "true" ]]; then
  echo "[deploy-oracle] Running remote bootstrap (docker/caddy/nginx)..."
  ssh "${SSH_OPTS[@]}" "${SSH_TARGET}" 'sudo bash -s' < "${ROOT_DIR}/scripts/bootstrap-oracle-vm.sh"
fi

echo "[deploy-oracle] Ensuring remote path exists..."
ssh "${SSH_OPTS[@]}" "${SSH_TARGET}" "sudo mkdir -p '${REMOTE_PATH}' && sudo chown -R '${REMOTE_USER}:${REMOTE_USER}' '${REMOTE_PATH}'"

if [[ "${SKIP_RSYNC}" == "false" ]]; then
  echo "[deploy-oracle] Syncing project to ${SSH_TARGET}:${REMOTE_PATH}..."
  rsync -rlz --delete \
    -e "ssh ${SSH_OPTS[*]}" \
    --exclude '.git' \
    --exclude '/node_modules' \
    --exclude '/public/uploads/' \
    --exclude '.next/cache' \
    --exclude '.next/dev' \
    --exclude 'playwright-report' \
    --exclude 'test-results' \
    --exclude '.env*' \
    ./ "${SSH_TARGET}:${REMOTE_PATH}/"
fi

echo "[deploy-oracle] Preparing runtime directories and env file..."
scp "${SSH_OPTS[@]}" .env.production "${SSH_TARGET}:${REMOTE_PATH}/.env.production"
ssh "${SSH_OPTS[@]}" "${SSH_TARGET}" "cd '${REMOTE_PATH}' && mkdir -p public/uploads/menu-headers && chmod -R a+rwX public/uploads"

echo "[deploy-oracle] Rebuilding and restarting remote stack..."
ssh "${SSH_OPTS[@]}" "${SSH_TARGET}" bash -s -- "${REMOTE_PATH}" "${BUILD_SHA}" "${PROFILE}" "${USE_CACHE}" "${VERSION}" "${BUILD_DATE}" <<'EOS'
set -euo pipefail

REMOTE_PATH="$1"
BUILD_SHA="$2"
PROFILE="$3"
USE_CACHE="$4"
VERSION="$5"
BUILD_DATE="$6"

cd "${REMOTE_PATH}"

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

if grep -q '^APP_VERSION=' .env.production; then
  sed -i -E "s/^APP_VERSION=.*/APP_VERSION=${VERSION}/" .env.production
else
  echo "APP_VERSION=${VERSION}" >> .env.production
fi

if [[ "${USE_CACHE}" == "true" ]]; then
  sudo docker compose --env-file .env.production -f docker-compose.prod.yml build osgfest-backoffice osgfest-menu
else
  sudo docker compose --env-file .env.production -f docker-compose.prod.yml build --no-cache osgfest-backoffice osgfest-menu
fi

sudo docker compose --env-file .env.production -f docker-compose.prod.yml --profile "${PROFILE}" up -d --remove-orphans
sudo bash "${REMOTE_PATH}/scripts/migrate-order-pickup-index.sh"
sudo docker compose --env-file .env.production -f docker-compose.prod.yml ps
EOS

if [[ "${SKIP_HEALTH_CHECK}" == "false" ]]; then
  echo "[deploy-oracle] Running remote health checks..."
  ssh "${SSH_OPTS[@]}" "${SSH_TARGET}" 'curl -fsS http://127.0.0.1:3101/api/health && echo && curl -fsS http://127.0.0.1:3102/api/health'
fi

echo "[deploy-oracle] Completed."
