#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
COMPOSE_FILE="${ROOT_DIR}/docker-compose.prod.yml"
ENV_FILE="${ROOT_DIR}/.env.production"
NO_CACHE=false
SKIP_CLEANUP=false

usage() {
    cat <<'USAGE'
Usage: ./scripts/deploy.sh [options]

Options:
  --no-cache      Force a clean Docker rebuild
  --skip-cleanup  Skip post-deploy Docker cleanup
  -h, --help      Show this help
USAGE
}

while [[ $# -gt 0 ]]; do
    case "$1" in
        --no-cache) NO_CACHE=true; shift ;;
        --skip-cleanup) SKIP_CLEANUP=true; shift ;;
        -h|--help) usage; exit 0 ;;
        *) echo "Unknown option: $1" >&2; usage; exit 1 ;;
    esac
done

if [[ ! -f "${ENV_FILE}" ]]; then
    echo "Missing ${ENV_FILE}. Create it from .env.production.example first." >&2
    exit 1
fi

upsert_env_var() {
    local key="$1"
    local value="$2"
    local escaped

    escaped="$(printf '%s' "${value}" | sed -e 's/[\\&|]/\\&/g')"
    if grep -q "^${key}=" "${ENV_FILE}"; then
        sed -i -E "s|^${key}=.*|${key}=${escaped}|" "${ENV_FILE}"
    else
        printf '%s=%s\n' "${key}" "${value}" >> "${ENV_FILE}"
    fi
}

# Without this the env file keeps whatever version was written by hand, and
# /api/health reports a release that is not the one running.
BUILD_SHA="$(git -C "${ROOT_DIR}" rev-parse --short HEAD 2>/dev/null || echo "unknown")"
BUILD_DATE="$(date -u +%Y-%m-%d)"
VERSION="$(node -p "require('${ROOT_DIR}/package.json').version")"
upsert_env_var "APP_VERSION" "${VERSION}"
upsert_env_var "APP_BUILD" "${BUILD_SHA}"
upsert_env_var "APP_BUILD_DATE" "${BUILD_DATE}"

echo "[deploy] Starting FantaFestando production stack (v${VERSION} ${BUILD_SHA})..."
build_cmd=(docker compose --env-file "${ENV_FILE}" -f "${COMPOSE_FILE}" build)
if [[ "${NO_CACHE}" == "true" ]]; then
    build_cmd+=(--no-cache)
fi
build_cmd+=(fantafestando-backoffice fantafestando-menu)
"${build_cmd[@]}"
docker compose --env-file "${ENV_FILE}" -f "${COMPOSE_FILE}" up -d --remove-orphans

echo "[deploy] Applying database migrations..."
"${ROOT_DIR}/scripts/migrate-order-pickup-index.sh"

echo "[deploy] Current service status:"
docker compose --env-file "${ENV_FILE}" -f "${COMPOSE_FILE}" ps

BACKOFFICE_CONTAINER="$(docker compose --env-file "${ENV_FILE}" -f "${COMPOSE_FILE}" ps -q fantafestando-backoffice)"
MONGO_CONTAINER="$(docker compose --env-file "${ENV_FILE}" -f "${COMPOSE_FILE}" ps -q mongo)"

if [[ -z "${BACKOFFICE_CONTAINER}" || -z "${MONGO_CONTAINER}" ]]; then
    echo "[deploy] Unable to resolve running service containers." >&2
    exit 1
fi

echo "[deploy] Verifying the running release..."
BACKOFFICE_PORT="$(grep -E '^BACKOFFICE_BIND_PORT=' "${ENV_FILE}" | cut -d= -f2- || true)"
RUNNING_BUILD="$(curl -fsS --retry 10 --retry-delay 2 --retry-all-errors \
    "http://127.0.0.1:${BACKOFFICE_PORT:-3101}/api/health" | sed -n 's/.*"release":"\([^"]*\)".*/\1/p')"
if [[ "${RUNNING_BUILD}" != *"${BUILD_SHA}"* ]]; then
    echo "[deploy] Running release is '${RUNNING_BUILD}', expected build ${BUILD_SHA}." >&2
    echo "[deploy] The containers were not recreated from the new image." >&2
    exit 1
fi
echo "[deploy] Running release: ${RUNNING_BUILD}"

echo "[deploy] Verifying active upload assets..."
bash "${ROOT_DIR}/scripts/verify-upload-assets.sh" "${BACKOFFICE_CONTAINER}" "${MONGO_CONTAINER}"

if [[ "${SKIP_CLEANUP}" == "false" ]]; then
    bash "${ROOT_DIR}/scripts/docker-post-deploy-cleanup.sh"
fi
