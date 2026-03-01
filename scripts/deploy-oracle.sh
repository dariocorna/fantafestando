#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REMOTE_HOST="${DEPLOY_HOST:-}"
REMOTE_USER="${DEPLOY_USER:-ubuntu}"
REMOTE_PATH="${DEPLOY_PATH:-/opt/osgfest}"
PROFILE="${DEPLOY_PROFILE:-demo}"
PROJECT_NAME="${DEPLOY_PROJECT_NAME:-osgfest}"
BACKOFFICE_PORT="${DEPLOY_BACKOFFICE_PORT:-3101}"
MENU_PORT="${DEPLOY_MENU_PORT:-3102}"
LOCAL_ENV_FILE="${DEPLOY_ENV_FILE:-.env.production}"
REMOTE_ENV_FILE_NAME="${DEPLOY_REMOTE_ENV_FILE_NAME:-.env.production}"
PRINTER_HOST="${DEPLOY_PRINTER_HOST:-}"
PRINTER_START_PORT="${DEPLOY_PRINTER_START_PORT:-}"
SSH_KEY="${DEPLOY_SSH_KEY:-}"
BOOTSTRAP=true
SKIP_BUILD=true
SKIP_RSYNC=false
SKIP_HEALTH_CHECK=false
USE_CACHE=false
NO_PROFILE=false

usage() {
  cat <<'USAGE'
Usage: ./scripts/deploy-oracle.sh --host <ip-or-alias> [options]

Options:
  --host <ip-or-alias>       Oracle VM host/IP (required)
  --user <ssh-user>          SSH user (default: ubuntu)
  --key <path>               SSH private key path
  --path <remote-path>       Remote app path (default: /opt/osgfest)
  --project-name <name>      Docker compose project name (default: osgfest)
  --backoffice-port <port>   Host bind port for backoffice (default: 3101)
  --menu-port <port>         Host bind port for menu (default: 3102)
  --env-file <local-path>    Local env file to upload (default: .env.production)
  --remote-env-file <name>   Remote env file name (default: .env.production)
  --profile <profile>        Docker compose profile (default: demo)
  --no-profile               Disable compose profile on `up`
  --printer-host <host>      Override PRINTER_EMULATOR_HOST in remote env file
  --printer-start-port <n>   Override PRINTER_EMULATOR_START_PORT in remote env file
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
    --project-name) PROJECT_NAME="${2:-}"; shift 2 ;;
    --backoffice-port) BACKOFFICE_PORT="${2:-}"; shift 2 ;;
    --menu-port) MENU_PORT="${2:-}"; shift 2 ;;
    --env-file) LOCAL_ENV_FILE="${2:-}"; shift 2 ;;
    --remote-env-file) REMOTE_ENV_FILE_NAME="${2:-}"; shift 2 ;;
    --profile) PROFILE="${2:-}"; shift 2 ;;
    --no-profile) NO_PROFILE=true; shift ;;
    --printer-host) PRINTER_HOST="${2:-}"; shift 2 ;;
    --printer-start-port) PRINTER_START_PORT="${2:-}"; shift 2 ;;
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

if [[ ! -f "${LOCAL_ENV_FILE}" ]]; then
  echo "Missing ${ROOT_DIR}/${LOCAL_ENV_FILE}. Create it from .env.production.example first." >&2
  exit 1
fi

if ! git diff --quiet || ! git diff --cached --quiet; then
  echo "[deploy-oracle] Warning: local working tree has uncommitted changes."
fi

BUILD_SHA="$(git rev-parse --short HEAD)"
VERSION="$(node -p "require('./package.json').version")"
BUILD_DATE="$(date '+%Y-%m-%dT%H:%M:%S%z')"

echo "[deploy-oracle] Host: ${REMOTE_USER}@${REMOTE_HOST}"
echo "[deploy-oracle] Path: ${REMOTE_PATH}"
echo "[deploy-oracle] Project: ${PROJECT_NAME}"
echo "[deploy-oracle] Ports: backoffice=${BACKOFFICE_PORT}, menu=${MENU_PORT}"
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
REMOTE_ENV_FILE="${REMOTE_PATH}/${REMOTE_ENV_FILE_NAME}"
scp "${SSH_OPTS[@]}" "${LOCAL_ENV_FILE}" "${SSH_TARGET}:${REMOTE_ENV_FILE}"
ssh "${SSH_OPTS[@]}" "${SSH_TARGET}" "cd '${REMOTE_PATH}' && mkdir -p public/uploads/menu-headers && chmod -R a+rwX public/uploads"

echo "[deploy-oracle] Rebuilding and restarting remote stack..."
ssh "${SSH_OPTS[@]}" "${SSH_TARGET}" bash -s -- "${REMOTE_PATH}" "${BUILD_SHA}" "${PROFILE}" "${USE_CACHE}" "${VERSION}" "${BUILD_DATE}" "${PROJECT_NAME}" "${BACKOFFICE_PORT}" "${MENU_PORT}" "${REMOTE_ENV_FILE_NAME}" "${PRINTER_HOST:-__EMPTY__}" "${PRINTER_START_PORT:-__EMPTY__}" "${NO_PROFILE}" <<'EOS'
set -euo pipefail

REMOTE_PATH="$1"
BUILD_SHA="$2"
PROFILE="$3"
USE_CACHE="$4"
VERSION="$5"
BUILD_DATE="$6"
PROJECT_NAME="$7"
BACKOFFICE_PORT="$8"
MENU_PORT="$9"
ENV_FILE_NAME="${10}"
PRINTER_HOST="${11:-__EMPTY__}"
PRINTER_START_PORT="${12:-__EMPTY__}"
NO_PROFILE="${13:-false}"
ENV_FILE="${REMOTE_PATH}/${ENV_FILE_NAME}"
COMPOSE_FILE="${REMOTE_PATH}/docker-compose.prod.yml"

cd "${REMOTE_PATH}"

if grep -q '^APP_BUILD=' "${ENV_FILE}"; then
  sed -i -E "s/^APP_BUILD=.*/APP_BUILD=${BUILD_SHA}/" "${ENV_FILE}"
else
  echo "APP_BUILD=${BUILD_SHA}" >> "${ENV_FILE}"
fi

if grep -q '^APP_BUILD_DATE=' "${ENV_FILE}"; then
  sed -i -E "s/^APP_BUILD_DATE=.*/APP_BUILD_DATE=\"${BUILD_DATE}\"/" "${ENV_FILE}"
else
  echo "APP_BUILD_DATE=\"${BUILD_DATE}\"" >> "${ENV_FILE}"
fi

if grep -q '^APP_VERSION=' "${ENV_FILE}"; then
  sed -i -E "s/^APP_VERSION=.*/APP_VERSION=${VERSION}/" "${ENV_FILE}"
else
  echo "APP_VERSION=${VERSION}" >> "${ENV_FILE}"
fi

if grep -q '^BACKOFFICE_BIND_PORT=' "${ENV_FILE}"; then
  sed -i -E "s/^BACKOFFICE_BIND_PORT=.*/BACKOFFICE_BIND_PORT=${BACKOFFICE_PORT}/" "${ENV_FILE}"
else
  echo "BACKOFFICE_BIND_PORT=${BACKOFFICE_PORT}" >> "${ENV_FILE}"
fi

if grep -q '^MENU_BIND_PORT=' "${ENV_FILE}"; then
  sed -i -E "s/^MENU_BIND_PORT=.*/MENU_BIND_PORT=${MENU_PORT}/" "${ENV_FILE}"
else
  echo "MENU_BIND_PORT=${MENU_PORT}" >> "${ENV_FILE}"
fi

if [[ "${PRINTER_HOST}" == "__EMPTY__" ]]; then
  PRINTER_HOST=""
fi

if [[ "${PRINTER_START_PORT}" == "__EMPTY__" ]]; then
  PRINTER_START_PORT=""
fi

if [[ -n "${PRINTER_HOST}" ]]; then
  if grep -q '^PRINTER_EMULATOR_HOST=' "${ENV_FILE}"; then
    sed -i -E "s|^PRINTER_EMULATOR_HOST=.*|PRINTER_EMULATOR_HOST=${PRINTER_HOST}|" "${ENV_FILE}"
  else
    echo "PRINTER_EMULATOR_HOST=${PRINTER_HOST}" >> "${ENV_FILE}"
  fi
fi

if [[ -n "${PRINTER_START_PORT}" ]]; then
  if grep -q '^PRINTER_EMULATOR_START_PORT=' "${ENV_FILE}"; then
    sed -i -E "s|^PRINTER_EMULATOR_START_PORT=.*|PRINTER_EMULATOR_START_PORT=${PRINTER_START_PORT}|" "${ENV_FILE}"
  else
    echo "PRINTER_EMULATOR_START_PORT=${PRINTER_START_PORT}" >> "${ENV_FILE}"
  fi
fi

compose_base=(sudo docker compose --env-file "${ENV_FILE}" -f "${COMPOSE_FILE}" -p "${PROJECT_NAME}")

if [[ "${USE_CACHE}" == "true" ]]; then
  "${compose_base[@]}" build osgfest-backoffice osgfest-menu
else
  "${compose_base[@]}" build --no-cache osgfest-backoffice osgfest-menu
fi

if [[ "${NO_PROFILE}" == "true" ]]; then
  "${compose_base[@]}" up -d --remove-orphans
else
  "${compose_base[@]}" --profile "${PROFILE}" up -d --remove-orphans
fi

sudo COMPOSE_PROJECT_NAME="${PROJECT_NAME}" ENV_FILE="${ENV_FILE}" COMPOSE_FILE="${COMPOSE_FILE}" bash "${REMOTE_PATH}/scripts/migrate-order-pickup-index.sh"
"${compose_base[@]}" ps
EOS

if [[ "${SKIP_HEALTH_CHECK}" == "false" ]]; then
  echo "[deploy-oracle] Running remote health checks..."
  ssh "${SSH_OPTS[@]}" "${SSH_TARGET}" "curl -fsS http://127.0.0.1:${BACKOFFICE_PORT}/api/health && echo && curl -fsS http://127.0.0.1:${MENU_PORT}/api/health"
fi

echo "[deploy-oracle] Completed."
