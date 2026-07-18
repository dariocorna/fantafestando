#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REMOTE_HOST="${DEPLOY_HOST:-}"
REMOTE_USER="${DEPLOY_USER:-}"
REMOTE_PATH="${DEPLOY_PATH:-/opt/fantafestando}"
PROFILE="${DEPLOY_PROFILE:-}"
PROJECT_NAME="${DEPLOY_PROJECT_NAME:-fantafestando}"
BACKOFFICE_PORT="${DEPLOY_BACKOFFICE_PORT:-3101}"
MENU_PORT="${DEPLOY_MENU_PORT:-3102}"
LOCAL_ENV_FILE="${DEPLOY_ENV_FILE:-.env.production}"
REMOTE_ENV_FILE_NAME="${DEPLOY_REMOTE_ENV_FILE_NAME:-.env.production}"
PRINTER_HOST="${DEPLOY_PRINTER_HOST:-}"
PRINTER_START_PORT="${DEPLOY_PRINTER_START_PORT:-}"
PLATFORM="${DEPLOY_PLATFORM:-linux/arm64}"
SSH_KEY="${DEPLOY_SSH_KEY:-}"
SKIP_RSYNC=false
SKIP_HEALTH_CHECK=false
SKIP_CLEANUP=false
USE_CACHE=true
NO_PROFILE=false

usage() {
  cat <<'USAGE'
Usage: ./scripts/deploy-rpi.sh --host <ssh-host-or-alias> [options]

Options:
  --host <ssh-host-or-alias> Raspberry Pi host/IP or SSH alias (required)
  --user <ssh-user>          SSH user override (optional)
  --key <path>               SSH private key path
  --path <remote-path>       Remote app path (default: /opt/fantafestando)
  --project-name <name>      Docker compose project name (default: fantafestando)
  --backoffice-port <port>   Host bind port for backoffice (default: 3101)
  --menu-port <port>         Host bind port for menu (default: 3102)
  --env-file <local-path>    Local env file to upload (default: .env.production)
  --remote-env-file <name>   Remote env file name (default: .env.production)
  --profile <profiles>       Docker compose profiles, comma-separated
  --no-profile               Disable compose profiles on `up`
  --platform <platform>      Buildx target platform (default: linux/arm64)
  --printer-host <host>      Override PRINTER_EMULATOR_HOST in remote env file
  --printer-start-port <n>   Override PRINTER_EMULATOR_START_PORT in remote env file
  --skip-rsync               Skip rsync step
  --skip-health-check        Skip remote /api/health checks
  --skip-cleanup             Skip remote Docker cleanup
  --use-cache                Use Docker cache on local build (default)
  --no-cache                 Force a clean local Docker rebuild
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

resolve_build_ref() {
  local build_sha

  build_sha="$(git rev-parse --short HEAD)"
  if [[ -n "$(git status --porcelain --untracked-files=normal)" ]]; then
    printf '%s-dirty\n' "${build_sha}"
  else
    printf '%s\n' "${build_sha}"
  fi
}

build_ssh_target() {
  if [[ -n "${REMOTE_USER}" ]]; then
    printf '%s@%s' "${REMOTE_USER}" "${REMOTE_HOST}"
  else
    printf '%s' "${REMOTE_HOST}"
  fi
}

platform_to_debian_arch() {
  case "$1" in
    linux/arm64) echo "arm64" ;;
    linux/amd64) echo "amd64" ;;
    linux/arm/v7) echo "armhf" ;;
    linux/arm/v6) echo "armel" ;;
    *) echo "" ;;
  esac
}

profile_enabled() {
  local target="$1"
  local raw profile_name

  IFS=',' read -r -a profile_list <<< "${PROFILE}"
  for raw in "${profile_list[@]}"; do
    profile_name="$(printf '%s' "${raw}" | sed 's/^[[:space:]]*//; s/[[:space:]]*$//')"
    if [[ -n "${profile_name}" && "${profile_name}" == "${target}" ]]; then
      return 0
    fi
  done

  return 1
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
    --platform) PLATFORM="${2:-}"; shift 2 ;;
    --printer-host) PRINTER_HOST="${2:-}"; shift 2 ;;
    --printer-start-port) PRINTER_START_PORT="${2:-}"; shift 2 ;;
    --skip-rsync) SKIP_RSYNC=true; shift ;;
    --skip-health-check) SKIP_HEALTH_CHECK=true; shift ;;
    --skip-cleanup) SKIP_CLEANUP=true; shift ;;
    --use-cache) USE_CACHE=true; shift ;;
    --no-cache) USE_CACHE=false; shift ;;
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
require_cmd docker
require_cmd node
require_cmd rsync
require_cmd ssh

if ! docker buildx version >/dev/null 2>&1; then
  echo "[deploy-rpi] docker buildx is required on the build machine." >&2
  exit 1
fi

if ! docker buildx inspect --bootstrap >/dev/null 2>&1; then
  echo "[deploy-rpi] Unable to bootstrap docker buildx. Ensure buildx and QEMU/binfmt support are available for ${PLATFORM}." >&2
  exit 1
fi

cd "${ROOT_DIR}"

if [[ ! -f "${LOCAL_ENV_FILE}" ]]; then
  echo "Missing ${ROOT_DIR}/${LOCAL_ENV_FILE}. Create it from .env.production.example first." >&2
  exit 1
fi

if [[ -n "$(git status --porcelain --untracked-files=normal)" ]]; then
  echo "[deploy-rpi] Warning: local working tree has uncommitted or untracked changes."
fi

BUILD_SHA="$(resolve_build_ref)"
VERSION="$(node -p "require('./package.json').version")"
BUILD_DATE="$(date '+%Y-%m-%dT%H:%M:%S%z')"
PROJECT_IMAGE_BASENAME="$(printf '%s' "${PROJECT_NAME}" | tr '[:upper:]' '[:lower:]' | sed -E 's/[^a-z0-9._-]+/-/g; s/^[._-]+//; s/[._-]+$//')"
if [[ -z "${PROJECT_IMAGE_BASENAME}" ]]; then
  echo "[deploy-rpi] Invalid project name: ${PROJECT_NAME}" >&2
  exit 1
fi
PROJECT_IMAGE_NAME="${PROJECT_IMAGE_BASENAME}-app"
TUNNEL_IMAGE_NAME="${PROJECT_IMAGE_NAME}-oracle-menu-tunnel"
SSH_OPTS=(-o StrictHostKeyChecking=accept-new)
if [[ -n "${SSH_KEY}" ]]; then
  SSH_OPTS+=(-i "${SSH_KEY}")
fi
SSH_TARGET="$(build_ssh_target)"
REMOTE_LOGIN_USER="$(ssh "${SSH_OPTS[@]}" "${SSH_TARGET}" 'id -un')"
REMOTE_ARCH="$(ssh "${SSH_OPTS[@]}" "${SSH_TARGET}" 'dpkg --print-architecture')"
EXPECTED_REMOTE_ARCH="$(platform_to_debian_arch "${PLATFORM}")"

if [[ -n "${EXPECTED_REMOTE_ARCH}" && "${REMOTE_ARCH}" != "${EXPECTED_REMOTE_ARCH}" ]]; then
  echo "[deploy-rpi] Remote architecture mismatch: target is ${REMOTE_ARCH}, requested platform is ${PLATFORM}." >&2
  exit 1
fi

echo "[deploy-rpi] Host: ${SSH_TARGET}"
echo "[deploy-rpi] Remote user: ${REMOTE_LOGIN_USER}"
echo "[deploy-rpi] Remote path: ${REMOTE_PATH}"
echo "[deploy-rpi] Project: ${PROJECT_NAME}"
echo "[deploy-rpi] Platform: ${PLATFORM}"
echo "[deploy-rpi] Profile: ${PROFILE:-<none>}"
echo "[deploy-rpi] Image: ${PROJECT_IMAGE_NAME}:${BUILD_SHA}"

local_images=("${PROJECT_IMAGE_NAME}:${BUILD_SHA}")

echo "[deploy-rpi] Building app image locally for ${PLATFORM}..."
app_build_cmd=(docker buildx build --platform "${PLATFORM}" -t "${PROJECT_IMAGE_NAME}:${BUILD_SHA}" --load .)
if [[ "${USE_CACHE}" == "false" ]]; then
  app_build_cmd=(docker buildx build --platform "${PLATFORM}" --no-cache -t "${PROJECT_IMAGE_NAME}:${BUILD_SHA}" --load .)
fi
"${app_build_cmd[@]}"

if profile_enabled "oracle-tunnel"; then
  echo "[deploy-rpi] Building oracle tunnel image locally for ${PLATFORM}..."
  tunnel_build_cmd=(docker buildx build --platform "${PLATFORM}" -f docker/oracle-menu-tunnel/Dockerfile -t "${TUNNEL_IMAGE_NAME}:${BUILD_SHA}" --load .)
  if [[ "${USE_CACHE}" == "false" ]]; then
    tunnel_build_cmd=(docker buildx build --platform "${PLATFORM}" --no-cache -f docker/oracle-menu-tunnel/Dockerfile -t "${TUNNEL_IMAGE_NAME}:${BUILD_SHA}" --load .)
  fi
  "${tunnel_build_cmd[@]}"
  local_images+=("${TUNNEL_IMAGE_NAME}:${BUILD_SHA}")
fi

echo "[deploy-rpi] Ensuring remote path exists..."
ssh "${SSH_OPTS[@]}" "${SSH_TARGET}" "sudo mkdir -p '${REMOTE_PATH}' && sudo chown -R '${REMOTE_LOGIN_USER}:${REMOTE_LOGIN_USER}' '${REMOTE_PATH}'"

if [[ "${SKIP_RSYNC}" == "false" ]]; then
  echo "[deploy-rpi] Syncing project to ${SSH_TARGET}:${REMOTE_PATH}..."
  rsync -rlz --delete     -e "ssh ${SSH_OPTS[*]}"     --exclude '.git'     --exclude '/node_modules'     --exclude '/public/uploads/'     --exclude '.next/cache'     --exclude '.next/dev'     --exclude 'playwright-report'     --exclude 'test-results'     --exclude '.env*'     ./ "${SSH_TARGET}:${REMOTE_PATH}/"
fi

echo "[deploy-rpi] Preparing runtime directories and env file..."
REMOTE_ENV_FILE="${REMOTE_PATH}/${REMOTE_ENV_FILE_NAME}"
scp "${SSH_OPTS[@]}" "${LOCAL_ENV_FILE}" "${SSH_TARGET}:${REMOTE_ENV_FILE}"
ssh "${SSH_OPTS[@]}" "${SSH_TARGET}" "cd '${REMOTE_PATH}' && mkdir -p public/uploads/menu-headers && chmod -R a+rwX public/uploads"

echo "[deploy-rpi] Loading images onto the Raspberry via SSH..."
docker save "${local_images[@]}" | ssh "${SSH_OPTS[@]}" "${SSH_TARGET}" 'sudo docker load'

echo "[deploy-rpi] Restarting remote stack without remote builds..."
ssh "${SSH_OPTS[@]}" "${SSH_TARGET}" bash -s -- "${REMOTE_PATH}" "${BUILD_SHA}" "${PROFILE:-__EMPTY__}" "${VERSION}" "${BUILD_DATE}" "${PROJECT_NAME}" "${PROJECT_IMAGE_NAME}" "${BACKOFFICE_PORT}" "${MENU_PORT}" "${REMOTE_ENV_FILE_NAME}" "${PRINTER_HOST:-__EMPTY__}" "${PRINTER_START_PORT:-__EMPTY__}" "${NO_PROFILE}" "${SKIP_CLEANUP}" <<'EOS'
set -euo pipefail

REMOTE_PATH="$1"
BUILD_SHA="$2"
PROFILE="$3"
if [[ "${PROFILE}" == "__EMPTY__" ]]; then
  PROFILE=""
fi
VERSION="$4"
BUILD_DATE="$5"
PROJECT_NAME="$6"
PROJECT_IMAGE_NAME="$7"
BACKOFFICE_PORT="$8"
MENU_PORT="$9"
ENV_FILE_NAME="${10}"
PRINTER_HOST="${11:-__EMPTY__}"
PRINTER_START_PORT="${12:-__EMPTY__}"
NO_PROFILE="${13:-false}"
SKIP_CLEANUP="${14:-false}"
ENV_FILE="${REMOTE_PATH}/${ENV_FILE_NAME}"
COMPOSE_FILE="${REMOTE_PATH}/docker-compose.prod.yml"

cd "${REMOTE_PATH}"

IFS=',' read -r -a PROFILE_LIST <<< "${PROFILE}"
COMPOSE_PROFILE_ARGS=()
for raw_profile in "${PROFILE_LIST[@]}"; do
  profile_name="$(printf '%s' "${raw_profile}" | sed 's/^[[:space:]]*//; s/[[:space:]]*$//')"
  if [[ -n "${profile_name}" ]]; then
    COMPOSE_PROFILE_ARGS+=(--profile "${profile_name}")
  fi
done

upsert_env_var() {
  local key="$1"
  local value="$2"
  local escaped

  escaped="$(printf '%s' "${value}" | sed -e 's/[\&|]/\&/g')"
  if grep -q "^${key}=" "${ENV_FILE}"; then
    sed -i -E "s|^${key}=.*|${key}=${escaped}|" "${ENV_FILE}"
  else
    printf '%s=%s
' "${key}" "${value}" >> "${ENV_FILE}"
  fi
}

upsert_env_var "APP_BUILD" "${BUILD_SHA}"
upsert_env_var "APP_BUILD_DATE" "${BUILD_DATE}"
upsert_env_var "APP_VERSION" "${VERSION}"
upsert_env_var "APP_RUNTIME_ENV_FILE" "${ENV_FILE_NAME}"
upsert_env_var "APP_IMAGE_NAME" "${PROJECT_IMAGE_NAME}"
upsert_env_var "APP_IMAGE_TAG" "${BUILD_SHA}"
upsert_env_var "BACKOFFICE_BIND_PORT" "${BACKOFFICE_PORT}"
upsert_env_var "MENU_BIND_PORT" "${MENU_PORT}"

if [[ "${PRINTER_HOST}" == "__EMPTY__" ]]; then
  PRINTER_HOST=""
fi

if [[ "${PRINTER_START_PORT}" == "__EMPTY__" ]]; then
  PRINTER_START_PORT=""
fi

if [[ -n "${PRINTER_HOST}" ]]; then
  upsert_env_var "PRINTER_EMULATOR_HOST" "${PRINTER_HOST}"
fi

if [[ -n "${PRINTER_START_PORT}" ]]; then
  upsert_env_var "PRINTER_EMULATOR_START_PORT" "${PRINTER_START_PORT}"
fi

compose_base=(sudo docker compose --env-file "${ENV_FILE}" -f "${COMPOSE_FILE}" -p "${PROJECT_NAME}")

if [[ "${NO_PROFILE}" == "true" || "${#COMPOSE_PROFILE_ARGS[@]}" -eq 0 ]]; then
  "${compose_base[@]}" up -d --no-build --remove-orphans
else
  "${compose_base[@]}" "${COMPOSE_PROFILE_ARGS[@]}" up -d --no-build --remove-orphans
fi

sudo COMPOSE_PROJECT_NAME="${PROJECT_NAME}" ENV_FILE="${ENV_FILE}" COMPOSE_FILE="${COMPOSE_FILE}" bash "${REMOTE_PATH}/scripts/migrate-order-pickup-index.sh"

backoffice_container="$("${compose_base[@]}" ps -q fantafestando-backoffice)"
mongo_container="$("${compose_base[@]}" ps -q mongo)"

if [[ -z "${backoffice_container}" || -z "${mongo_container}" ]]; then
  echo "[deploy-rpi] Unable to resolve running service containers." >&2
  exit 1
fi

bash "${REMOTE_PATH}/scripts/verify-upload-assets.sh" "${backoffice_container}" "${mongo_container}"

"${compose_base[@]}" ps

if [[ "${SKIP_CLEANUP}" == "false" ]]; then
  if [[ -f "${REMOTE_PATH}/scripts/docker-post-deploy-cleanup.sh" ]]; then
    sudo bash "${REMOTE_PATH}/scripts/docker-post-deploy-cleanup.sh"
  else
    echo "[deploy-rpi] Cleanup helper missing on remote, running inline fallback."
    sudo docker image prune -af --filter until=168h || true
    sudo docker builder prune -af --filter until=48h || true
  fi
fi
EOS

if [[ "${SKIP_HEALTH_CHECK}" == "false" ]]; then
  echo "[deploy-rpi] Running remote health checks..."
  ssh "${SSH_OPTS[@]}" "${SSH_TARGET}" "curl -fsS http://127.0.0.1:${BACKOFFICE_PORT}/api/health && echo && curl -fsS http://127.0.0.1:${MENU_PORT}/api/health"
fi

echo "[deploy-rpi] Completed."
