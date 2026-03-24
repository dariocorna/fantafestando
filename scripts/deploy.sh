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

echo "[deploy] Starting FantaFestando production stack..."
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

echo "[deploy] Verifying active upload assets..."
bash "${ROOT_DIR}/scripts/verify-upload-assets.sh" "${BACKOFFICE_CONTAINER}" "${MONGO_CONTAINER}"

if [[ "${SKIP_CLEANUP}" == "false" ]]; then
    bash "${ROOT_DIR}/scripts/docker-post-deploy-cleanup.sh"
fi
