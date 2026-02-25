#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 1 ]]; then
    echo "Usage: $0 <backup-file.archive.gz>" >&2
    exit 1
fi

BACKUP_FILE="$1"
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
COMPOSE_FILE="${ROOT_DIR}/docker-compose.prod.yml"
ENV_FILE="${ROOT_DIR}/.env.production"

if [[ ! -f "${ENV_FILE}" ]]; then
    echo "Missing ${ENV_FILE}." >&2
    exit 1
fi

if [[ ! -f "${BACKUP_FILE}" ]]; then
    echo "Backup file not found: ${BACKUP_FILE}" >&2
    exit 1
fi

echo "[restore] Restoring MongoDB from ${BACKUP_FILE}..."
docker compose --env-file "${ENV_FILE}" -f "${COMPOSE_FILE}" exec -T mongo sh -c '
  mongorestore \
    --username "$MONGO_INITDB_ROOT_USERNAME" \
    --password "$MONGO_INITDB_ROOT_PASSWORD" \
    --authenticationDatabase admin \
    --archive --gzip --drop
' < "${BACKUP_FILE}"

echo "[restore] Done."
