#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
COMPOSE_FILE="${ROOT_DIR}/docker-compose.prod.yml"
ENV_FILE="${ROOT_DIR}/.env.production"

if [[ ! -f "${ENV_FILE}" ]]; then
    echo "Missing ${ENV_FILE}." >&2
    exit 1
fi

BUILD_ARG="--build"
if [[ "${1:-}" == "--no-build" ]]; then
    BUILD_ARG=""
fi

echo "[update] Updating services..."
docker compose --env-file "${ENV_FILE}" -f "${COMPOSE_FILE}" up -d ${BUILD_ARG} --remove-orphans

echo "[update] Applying database migrations..."
"${ROOT_DIR}/scripts/migrate-order-pickup-index.sh"

echo "[update] Current service status:"
docker compose --env-file "${ENV_FILE}" -f "${COMPOSE_FILE}" ps
