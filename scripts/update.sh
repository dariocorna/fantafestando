#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
COMPOSE_FILE="${ROOT_DIR}/docker-compose.prod.yml"
ENV_FILE="${ROOT_DIR}/.env.production"
SKIP_CLEANUP=false

usage() {
    cat <<'USAGE'
Usage: ./scripts/update.sh [--no-build] [--skip-cleanup]

Options:
  --no-build      Restart services without rebuilding images
  --skip-cleanup  Skip post-update Docker cleanup
  -h, --help      Show this help
USAGE
}

if [[ ! -f "${ENV_FILE}" ]]; then
    echo "Missing ${ENV_FILE}." >&2
    exit 1
fi

BUILD_ARG="--build"
while [[ $# -gt 0 ]]; do
    case "$1" in
        --no-build) BUILD_ARG=""; shift ;;
        --skip-cleanup) SKIP_CLEANUP=true; shift ;;
        -h|--help) usage; exit 0 ;;
        *) echo "Unknown option: $1" >&2; usage; exit 1 ;;
    esac
done

echo "[update] Updating services..."
docker compose --env-file "${ENV_FILE}" -f "${COMPOSE_FILE}" up -d ${BUILD_ARG} --remove-orphans

echo "[update] Applying database migrations..."
"${ROOT_DIR}/scripts/migrate-order-pickup-index.sh"

echo "[update] Current service status:"
docker compose --env-file "${ENV_FILE}" -f "${COMPOSE_FILE}" ps

if [[ "${SKIP_CLEANUP}" == "false" ]]; then
    bash "${ROOT_DIR}/scripts/docker-post-deploy-cleanup.sh"
fi
