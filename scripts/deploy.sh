#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
COMPOSE_FILE="${ROOT_DIR}/docker-compose.prod.yml"
ENV_FILE="${ROOT_DIR}/.env.production"

if [[ ! -f "${ENV_FILE}" ]]; then
    echo "Missing ${ENV_FILE}. Create it from .env.production.example first." >&2
    exit 1
fi

echo "[deploy] Starting OSGFest production stack..."
docker compose --env-file "${ENV_FILE}" -f "${COMPOSE_FILE}" up -d --build --remove-orphans

echo "[deploy] Applying database migrations..."
"${ROOT_DIR}/scripts/migrate-order-pickup-index.sh"

echo "[deploy] Current service status:"
docker compose --env-file "${ENV_FILE}" -f "${COMPOSE_FILE}" ps
